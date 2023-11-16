# 一、说明  
iot-gw 使用 pipy + modbus协议（RS485通信）采集iot设备数据。  
# 二、编译 pipy + modbus-nmi.so 
需要使用root权限操作如下步骤：  
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
git remote add origin https://github.com/flomesh-io/fgw.git
git config core.sparseCheckout true
git sparse-checkout set /iot-gw/modbus-nmi/
git pull origin main 
mv iot-gw/modbus-nmi .
rmdir -p iot-gw
cd modbus-nmi && make && cp modbus-nmi.so /root/flomesh/bin/
cd /root/flomesh/bin
```
## 4. 编译完成后，在 /root/flomesh/bin 目录有如下这些文件    
<img width="665" alt="image" src="https://github.com/wanpf/fgw/assets/2276200/9c4b2bfe-156f-40ba-82be-a2c4f389f635">

# 三、配置、启动采集程序   
1. 下载 iot-gw/pjs 目录下的文件保存到 /root/pipy-modbus 目录下    
2. 将 /root/flomesh/bin 下编译好的文件拷贝到 /root/pipy-modbus 目录下
3. 修改 /root/pipy-modbus/config.json 配置文件  
   a）修改连接iot设备的名称，比如："deviceName": "/dev/ttyUSB0"  
   b）修改设备通讯录地址，比如："slaveID": 1  
   c）修改波特率，比如："baud": 9600  
   d）修改读取寄存器地址，比如："addr": 2  
   e）修改数据类型，比如："type": "short"  
   运行 /root/pipy-modbus/run.sh 启动采集程序  
4. 采集的数据存储在 /root/pipy-modbus/data 目录下。 
