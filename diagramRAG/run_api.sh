#!/bin/bash

# 激活虚拟环境
source ./venv/bin/activate

# 启动API服务器，监听所有地址
uvicorn api:app --host 0.0.0.0 --port 8000 --reload

# 提示用户API已启动
echo "API server is running at http://localhost:8000"
echo "API documentation is available at http://localhost:8000/docs" 