# 编译 pipy + modbus-nmi.so 
需要使用root权限操作如下步骤  
## 1. 编译pipy  
```bash
mkdir -p /root/flomesh/bin
cd /root/flomesh
git clone https://github.com/flomesh-io/pipy.git
cd pipy && ./build.sh
cp bin/pipy /root/flomesh/bin/
```
## 2. 编译依赖库 libmodbus    
```bash
cd /root/flomesh
wget -q "https://github.com/stephane/libmodbus/releases/download/v3.1.10/libmodbus-3.1.10.tar.gz"
tar zxvf libmodbus-3.1.10.tar.gz
cd libmodbus-3.1.10/ && ./configure && make -j `nproc` && make install
cp ./src/.libs/libmodbus.so* /root/flomesh/bin/
```
## 3. 编译 modbus-nmi.so  
```bash
cd /root/flomesh/pipy/samples/nmi/
git init
git remote add origin https://github.com/wanpf/fgw.git
git config core.sparseCheckout true
git sparse-checkout set /iot-gw/modbus-nmi/
git pull origin iot-gw
mv iot-gw/modbus-nmi .
rmdir -p iot-gw
cd modbus-nmi && make && cp modbus-nmi.so /root/flomesh/bin/
cd /root/flomesh/bin
```
## 4. 编译完成后，在 /root/flomesh/bin 目录有如下这些文件    
<img width="665" alt="image" src="https://github.com/wanpf/fgw/assets/2276200/9c4b2bfe-156f-40ba-82be-a2c4f389f635">

