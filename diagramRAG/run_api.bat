@echo off
echo 使用WSL启动diagram RAG API服务...

REM 使用WSL运行Linux命令来激活虚拟环境并启动服务
wsl -e bash -c "cd /mnt/c/Users/Administrator/Desktop/AI_study/BIAN_AI/AI_BIAN/diagramRAG && source ./venv/bin/activate && uvicorn api:app --host 0.0.0.0 --port 8000 --reload"

echo API服务器已启动：http://localhost:8000
echo API文档地址：http://localhost:8000/docs 