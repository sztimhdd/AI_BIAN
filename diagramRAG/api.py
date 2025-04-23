import os
import json
import logging
from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sentence_transformers import SentenceTransformer
import chromadb
from chromadb.utils.embedding_functions import SentenceTransformerEmbeddingFunction
import tarfile
import shutil

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)

# 常量定义
COLLECTION_NAME = "bian_diagrams"
# 从环境变量获取挂载路径，默认为本地开发时的相对路径
CHROMA_DB_VOLUME_MOUNT_PATH = os.getenv("CHROMA_VOLUME_MOUNT_PATH", "./chroma_db") 
CHROMA_DB_PATH = os.path.join(CHROMA_DB_VOLUME_MOUNT_PATH, "diagrams_db") 
# 不在这里创建目录，让 setup_database 控制
# os.makedirs(CHROMA_DB_PATH, exist_ok=True) 
MODEL_NAME = "all-MiniLM-L6-v2"
TOP_K = 1  # 默认返回的图表数量

# --- setup_database 函数定义 ---
def setup_database():
    """设置数据库目录和文件: 检查初始化标记，如果未设置，则解压 tar.gz 文件"""
    flag_file = os.path.join(CHROMA_DB_PATH, ".initialized")
    if os.path.exists(flag_file):
        logging.info(f"数据库 {CHROMA_DB_PATH} 已存在初始化标记，跳过设置")
        return

    # 查找压缩包路径 (Railway 构建环境中通常在 /app 下)
    tar_filename = "chroma_db_diagrams.tar.gz"
    possible_tar_paths = [
        os.path.join(os.getcwd(), tar_filename), # 当前工作目录
        os.path.join("/app", tar_filename),      # Railway 的 /app 目录
        os.path.join(os.path.dirname(__file__), tar_filename) # 脚本所在目录 (备选)
    ]
    
    tar_path = None
    for p in possible_tar_paths:
        if os.path.exists(p):
            tar_path = p
            logging.info(f"找到数据库压缩包: {tar_path}")
            break
    
    if not tar_path:
        # 如果找不到压缩包，这是一个严重错误，阻止启动
        logging.error(f"错误：找不到数据库压缩包，尝试过以下路径: {possible_tar_paths}")
        raise FileNotFoundError(f"找不到数据库压缩包，尝试过以下路径: {possible_tar_paths}")

    try:
        logging.info(f"开始解压 {tar_path} 到 {CHROMA_DB_PATH}...")
        
        # 确保目标父目录存在
        target_parent_dir = os.path.dirname(CHROMA_DB_PATH)
        os.makedirs(target_parent_dir, exist_ok=True)
        logging.info(f"确保目标父目录存在: {target_parent_dir}")

        # 如果目标目录已存在但未初始化，先删除以确保清洁状态
        if os.path.exists(CHROMA_DB_PATH):
             logging.warning(f"目标目录 {CHROMA_DB_PATH} 已存在但未初始化，将删除重建")
             shutil.rmtree(CHROMA_DB_PATH)
        os.makedirs(CHROMA_DB_PATH) # 显式创建目标目录
        logging.info(f"创建目标目录: {CHROMA_DB_PATH}")

        # 解压
        with tarfile.open(tar_path, "r:gz") as tar:
            logging.info(f"正在解压 {tar_filename} ...")
            tar.extractall(path=CHROMA_DB_PATH) 
            logging.info(f"解压完成。检查嵌套目录...")
            
            # --- 处理可能的嵌套目录 ---
            extracted_items = os.listdir(CHROMA_DB_PATH)
            # 检查解压后根目录是否只包含一个目录 (常见的压缩包结构)
            if len(extracted_items) == 1 and os.path.isdir(os.path.join(CHROMA_DB_PATH, extracted_items[0])):
                 nested_dir_name = extracted_items[0]
                 nested_dir_path = os.path.join(CHROMA_DB_PATH, nested_dir_name)
                 # 只在嵌套目录名与期望的 'chroma_db_diagrams' (或类似) 不同时处理，或者总是处理
                 # 这里选择总是处理单层嵌套目录
                 logging.info(f"检测到单层嵌套目录 {nested_dir_path}，将移动内容到上层 {CHROMA_DB_PATH}...")
                 
                 # 创建临时目录用于移动，避免直接移动到自身产生错误
                 temp_move_dir = CHROMA_DB_PATH + "_temp_move"
                 # 确保临时目录不存在
                 if os.path.exists(temp_move_dir):
                     shutil.rmtree(temp_move_dir)
                 os.makedirs(temp_move_dir, exist_ok=True)

                 # 移动内容到临时目录
                 for item in os.listdir(nested_dir_path):
                     shutil.move(os.path.join(nested_dir_path, item), os.path.join(temp_move_dir, item))
                 
                 # 删除空的嵌套目录
                 os.rmdir(nested_dir_path)
                 
                 # 将内容从临时目录移回目标目录
                 for item in os.listdir(temp_move_dir):
                      shutil.move(os.path.join(temp_move_dir, item), os.path.join(CHROMA_DB_PATH, item))
                 
                 # 删除临时目录
                 os.rmdir(temp_move_dir)
                 logging.info(f"嵌套目录内容移动完成.")
            else:
                 logging.info("未检测到需要处理的单层嵌套目录。")
            # --- 嵌套目录处理结束 ---

        # 创建标记文件
        with open(flag_file, "w") as f:
            f.write("initialized")
        logging.info(f"在 {CHROMA_DB_PATH} 创建初始化标记文件 .initialized")

        logging.info(f"数据库成功初始化到 {CHROMA_DB_PATH}")

    except Exception as e:
        logging.error(f"解压或设置数据库时出错: {e}")
        # 在启动阶段失败很重要，需要抛出异常让 Railway 知道启动失败
        raise

# 定义输入模型
class RetrieveDiagramsRequest(BaseModel):
    question: str = Field(..., description="用户查询")
    numResults: int = Field(TOP_K, description="要返回的结果数量")
    rerank: bool = Field(True, description="是否重新排序结果")
    context: Optional[Dict[str, Any]] = Field(None, description="可选的对话上下文")

# 定义输出文档模型
class DiagramDocument(BaseModel):
    text: str = Field(..., description="图表的文本描述")
    filename: str = Field(..., description="文件名或标识符")
    source_display_name: str = Field(..., description="显示名称")
    svg_content: str = Field(..., description="SVG 图表内容")
    source_url: str = Field(..., description="图表来源 URL")
    metadata: Dict[str, Any] = Field(..., description="图表元数据")

# 定义响应模型
class DiagramRetrievalResponse(BaseModel):
    documents: List[DiagramDocument] = Field(..., description="检索到的图表文档")

# 创建 FastAPI 应用
app = FastAPI(
    title="BIAN Diagram RAG API",
    description="用于检索 BIAN 图表的 RAG API",
    version="1.0.0"
)

# 添加 CORS 中间件
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 加载嵌入模型和数据库的函数
@app.on_event("startup")
async def startup_event():
    global embedding_function, client, collection
    
    try:
        # --- 首先调用 setup_database ---
        setup_database() 
        
        logging.info(f"Loading embedding model: {MODEL_NAME}...")
        embedding_function = SentenceTransformerEmbeddingFunction(model_name=MODEL_NAME)
        
        logging.info(f"Initializing ChromaDB client at path: {CHROMA_DB_PATH}")
        # setup_database 确保了目录存在，无需再次创建
        client = chromadb.PersistentClient(path=CHROMA_DB_PATH)
        
        logging.info(f"Getting collection: {COLLECTION_NAME}")
        # 现在 setup_database 已经运行，get_collection 应该能成功
        collection = client.get_collection(name=COLLECTION_NAME)
        
        logging.info("Startup completed successfully.")
    except Exception as e:
        logging.error(f"Error during startup after database setup attempt: {e}")
        # 再次抛出，确保启动失败能被捕获
        raise

# 检索图表端点
@app.post("/retrieve_diagrams", response_model=DiagramRetrievalResponse)
async def retrieve_diagrams(request: RetrieveDiagramsRequest):
    try:
        logging.info(f"Received query: {request.question}")
        
        results = collection.query(
            query_texts=[request.question],
            n_results=request.numResults
        )
        
        if not results or not results['ids'] or len(results['ids'][0]) == 0:
            logging.warning("No results found for the query")
            return DiagramRetrievalResponse(documents=[])
        
        documents = []
        for i, doc_id in enumerate(results['ids'][0]):
            metadata = results['metadatas'][0][i] if results['metadatas'] else {}
            svg_content = metadata.get('svg_content', '')
            text_elements = metadata.get('text_elements', [])
            original_metadata = metadata.get('metadata', {})
            description = metadata.get('description', '')
            if not description and text_elements:
                description = " ".join(text_elements)
            source_url = metadata.get('source_url', '')
            
            doc = DiagramDocument(
                text=description,
                filename=f"diagram_{doc_id}.svg",
                source_display_name=original_metadata.get('title', f"BIAN Diagram {i+1}"),
                svg_content=svg_content,
                source_url=source_url,
                metadata=original_metadata
            )
            documents.append(doc)
        
        logging.info(f"Returning {len(documents)} diagrams")
        return DiagramRetrievalResponse(documents=documents)
    
    except Exception as e:
        logging.error(f"Error retrieving diagrams: {e}")
        raise HTTPException(status_code=500, detail=f"Error retrieving diagrams: {str(e)}")

# 健康检查端点
@app.get("/health")
async def health_check():
    return {"status": "ok"}

# 运行服务器的入口点
if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000)) 
    # 本地运行时也执行 setup_database
    try:
        setup_database() 
    except Exception as e:
         logging.error(f"Failed to setup database during local run: {e}")
         # 根据需要决定是否退出
         # exit(1) 
    uvicorn.run("api:app", host="0.0.0.0", port=port, reload=False) # reload=False for production/deployment 