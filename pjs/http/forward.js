/*
 * MIT License
 *
 * Copyright (c) since 2021,  flomesh.io Authors.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

((
  { isDebugEnabled } = pipy.solve('config.js'),

  {
    shuffle,
    failover,
  } = pipy.solve('lib/utils.js'),

  retryCounter = new stats.Counter('fgw_upstream_rq_retry', ['service_name']),
  retrySuccessCounter = new stats.Counter('fgw_upstream_rq_retry_success', ['service_name']),
  retryLimitCounter = new stats.Counter('fgw_upstream_rq_retry_limit_exceeded', ['service_name']),
  retryOverflowCounter = new stats.Counter('fgw_upstream_rq_retry_overflow', ['service_name']),
  retryBackoffCounter = new stats.Counter('fgw_upstream_rq_retry_backoff_exponential', ['service_name']),
  retryBackoffLimitCounter = new stats.Counter('fgw_upstream_rq_retry_backoff_ratelimited', ['service_name']),

  makeServiceConfig = (serviceConfig) => (
    serviceConfig && (
      (
        endpointAttributes = {},
        obj = {
          targetBalancer: serviceConfig.Endpoints && new algo.RoundRobinLoadBalancer(
            shuffle(Object.fromEntries(Object.entries(serviceConfig.Endpoints)
              .map(([k, v]) => (endpointAttributes[k] = v, v.hash = algo.hash(k), [k, v.Weight]))
              .filter(([k, v]) => v > 0)
            ))
          ),
          endpointAttributes,
          ...(serviceConfig.StickyCookieName && ({
            stickyCookie: {
              name: serviceConfig.StickyCookieName,
              expires: serviceConfig.StickyCookieExpires || 3600,
              hashTable: Object.fromEntries(Object.keys(serviceConfig.Endpoints).map(
                k => (
                  [algo.hash(k), k]
                )
              ))
            }
          })),
          failoverBalancer: serviceConfig.Endpoints && failover(Object.fromEntries(Object.entries(serviceConfig.Endpoints).map(([k, v]) => [k, v.Weight]))),
          needRetry: Boolean(serviceConfig.RetryPolicy?.NumRetries),
          numRetries: serviceConfig.RetryPolicy?.NumRetries,
          retryStatusCodes: (serviceConfig.RetryPolicy?.RetryOn || '5xx').split(',').reduce(
            (lut, code) => (
              code.endsWith('xx') ? (
                new Array(100).fill(0).forEach((_, i) => lut[(code.charAt(0) | 0) * 100 + i] = true)
              ) : (
                lut[code | 0] = true
              ),
              lut
            ),
            []
          ),
          retryBackoffBaseInterval: serviceConfig.RetryPolicy?.RetryBackoffBaseInterval > 1 ? 1 : serviceConfig.RetryPolicy?.RetryBackoffBaseInterval,
          retryCounter: retryCounter.withLabels(serviceConfig.name),
          retrySuccessCounter: retrySuccessCounter.withLabels(serviceConfig.name),
          retryLimitCounter: retryLimitCounter.withLabels(serviceConfig.name),
          retryOverflowCounter: retryOverflowCounter.withLabels(serviceConfig.name),
          retryBackoffCounter: retryBackoffCounter.withLabels(serviceConfig.name),
          retryBackoffLimitCounter: retryBackoffLimitCounter.withLabels(serviceConfig.name),
          muxHttpOptions: {
            version: () => (__domain?.RouteType === 'GRPC' || __domain?.RouteType === 'HTTP2') ? 2 : 1,
            maxMessages: serviceConfig.ConnectionSettings?.http?.MaxRequestsPerConnection
          },
        },
      ) => (
        obj.retryCounter.zero(),
        obj.retrySuccessCounter.zero(),
        obj.retryLimitCounter.zero(),
        obj.retryOverflowCounter.zero(),
        obj.retryBackoffCounter.zero(),
        obj.retryBackoffLimitCounter.zero(),
        obj
      )
    )()
  ),

  serviceConfigs = new algo.Cache(makeServiceConfig),

  shouldRetry = (statusCode) => (
    (
      again = _serviceConfig?.retryStatusCodes?.[statusCode] ? (
        (_retryCount < _serviceConfig.numRetries) ? (
          _serviceConfig.retryCounter.increase(),
          _serviceConfig.retryBackoffCounter.increase(),
          _retryCount++,
          true
        ) : (
          _serviceConfig.retryLimitCounter.increase(),
          false
        )
      ) : (
        _retryCount > 0 && _serviceConfig.retrySuccessCounter.increase(),
        false
      )
    ) => (
      (!again && _failoverBalancer && (!statusCode || statusCode > '499')) ? (
        _targetBalancer = _failoverBalancer,
        _failoverBalancer = null,
        _retryCount = 0,
        true
      ) : again
    )
  )(),

  getCookies = cookie => (
    (
      cookies = {},
      arr,
      kv,
    ) => (
      cookie && (
        (arr = cookie.split(';')) && (
          arr.forEach(
            p => (
              kv = p.split('='),
              (kv.length > 1) && (
                cookies[kv[0].trim()] = kv[1].trim()
              )
            )
          )
        ),
        cookies
      )
    )
  )(),

) => pipy({
  _retryCount: 0,
  _serviceConfig: null,
  _targetBalancer: null,
  _failoverBalancer: null,
  _muxHttpOptions: null,
  _cookies: null,
  _cookieId: null,
  _isRetry: false,
})

.import({
  __domain: 'route',
  __service: 'service',
  __cert: 'connect-tls',
  __target: 'connect-tcp',
  __metricLabel: 'connect-tcp',
})

.pipeline()
.onStart(
  () => void (
    (_serviceConfig = serviceConfigs.get(__service)) && (
      __metricLabel = __service.name,
      _muxHttpOptions = _serviceConfig.muxHttpOptions,
      _targetBalancer = _serviceConfig.targetBalancer,
      _serviceConfig.failoverBalancer && (
        _failoverBalancer = _serviceConfig.failoverBalancer
      )
    )
  )
)
.branch(
  () => _serviceConfig?.needRetry || _failoverBalancer, (
    $=>$
    .replay({
      delay: () => _serviceConfig.retryBackoffBaseInterval * Math.min(10, Math.pow(2, _retryCount-1)|0)
    }).to(
      $=>$
      .link('upstream')
      .replaceMessageStart(
        msg => (
          shouldRetry(msg?.head?.status) ? (
            _isRetry = true,
            new StreamEnd('Replay')
          ) : msg
        )
      )
    )
  ), (
    $=>$.link('upstream')
  )
)

.pipeline('upstream')
.handleMessageStart(
  msg => (
    _serviceConfig && (
      _serviceConfig.stickyCookie && (
        _cookieId = null,
        !_isRetry && (_cookies = getCookies(msg?.head?.headers?.cookie)) && (_cookieId = _cookies[_serviceConfig.stickyCookie.name]) && (
          _cookieId = _serviceConfig.stickyCookie.hashTable[_cookieId]
        )
      ),
      _cookieId ? (
        __target = _cookieId
      ) : (
        __target = _targetBalancer?.borrow?.({})?.id
      ),
      __target
    ) && (
      (
        attrs = _serviceConfig?.endpointAttributes?.[__target]
      ) => (
        attrs?.UpstreamCert ? (
          __cert = attrs?.UpstreamCert
        ) : (
          __cert = __service?.UpstreamCert
        ),
        _cookieId ? (
          _cookieId = null
        ) : (
          _serviceConfig?.stickyCookie && attrs?.hash && (
            _cookieId = _serviceConfig.stickyCookie.name + '=' + attrs.hash + '; expires='
                      + new Date(new Date().getTime() + 1000 * _serviceConfig.stickyCookie.expires).toUTCString()
                      + '; max-age=' + _serviceConfig.stickyCookie.expires
          )
        )
      )
    )()
  )
)
.branch(
  isDebugEnabled, (
    $=>$.handleStreamStart(
      () => (
        console.log('[forward] target, cert:', __target, Boolean(__cert))
      )
    )
  )
)
.branch(
  () => !__target, (
    $=>$
    .branch(
      () => _failoverBalancer, (
        $=>$.replaceMessageStart(
          () => (
            _targetBalancer = _failoverBalancer,
            _failoverBalancer = null,
            _isRetry = true,
            new StreamEnd('Replay')
          )
        )
      ), (
        $=>$.chain()
      )
    )
  ),
  (
    $=>$.muxHTTP(() => undefined, () => _muxHttpOptions).to(
      $=>$.branch(
        () => __cert, (
          $=>$.use('lib/connect-tls.js')
        ), (
          $=>$.use('lib/connect-tcp.js')
        )
      )
    )
    .branch(
      () => _cookieId, (
        $=>$.handleMessageStart(
          msg => (
            msg?.head?.headers && (
              !msg.head.headers['set-cookie'] && (
                msg.head.headers['set-cookie'] = []
              ),
              (typeof msg.head.headers['set-cookie'] === 'string') ? (
                msg.head.headers['set-cookie'] = [msg.head.headers['set-cookie'], _cookieId]
              ) : (
                msg.head.headers['set-cookie'].push(_cookieId)
              )
            )
          )
        )
      ), (
        $=>$
      )
    )
  )
)

)()