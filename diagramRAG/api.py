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
# CHROMA_DB_PATH = "./chroma_db_diagrams" # 旧路径
# 从环境变量获取挂载路径，默认为本地路径
CHROMA_DB_VOLUME_MOUNT_PATH = os.getenv("CHROMA_VOLUME_MOUNT_PATH", "./chroma_db") 
CHROMA_DB_PATH = os.path.join(CHROMA_DB_VOLUME_MOUNT_PATH, "diagrams_db") 
# 确保目标目录存在
os.makedirs(CHROMA_DB_PATH, exist_ok=True) 
MODEL_NAME = "all-MiniLM-L6-v2"
TOP_K = 1  # 默认返回的图表数量

# 添加 setup_database 函数
def setup_database():
    """设置数据库目录和文件: 检查初始化标记，如果未设置，则解压 tar.gz 文件"""
    flag_file = os.path.join(CHROMA_DB_PATH, ".initialized")
    if os.path.exists(flag_file):
        logging.info(f"数据库 {CHROMA_DB_PATH} 已存在初始化标记，跳过设置")
        return

    # 查找压缩包路径 (Railway 构建环境中通常在 /app 下)
    # 相对于脚本的位置可能不可靠，优先查找相对于当前工作目录和 /app
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
        raise FileNotFoundError(f"找不到数据库压缩包，尝试过以下路径: {possible_tar_paths}")

    try:
        logging.info(f"开始解压 {tar_path} 到 {CHROMA_DB_PATH}...")
        
        # 确保目标父目录存在
        target_parent_dir = os.path.dirname(CHROMA_DB_PATH)
        os.makedirs(target_parent_dir, exist_ok=True)

        # 如果目标目录已存在但未初始化，先删除以确保清洁状态
        if os.path.exists(CHROMA_DB_PATH):
             logging.warning(f"目标目录 {CHROMA_DB_PATH} 已存在但未初始化，将删除重建")
             shutil.rmtree(CHROMA_DB_PATH)
        os.makedirs(CHROMA_DB_PATH) # 显式创建目标目录

        # 解压
        with tarfile.open(tar_path, "r:gz") as tar:
            # 直接解压到目标目录
            tar.extractall(path=CHROMA_DB_PATH) 
            
            # --- 处理可能的嵌套目录 ---
            # 检查解压后根目录是否只包含一个目录 (通常是 'chroma_db_diagrams')
            extracted_items = os.listdir(CHROMA_DB_PATH)
            if len(extracted_items) == 1 and os.path.isdir(os.path.join(CHROMA_DB_PATH, extracted_items[0])):
                 nested_dir_name = extracted_items[0]
                 nested_dir_path = os.path.join(CHROMA_DB_PATH, nested_dir_name)
                 logging.info(f"检测到嵌套目录 {nested_dir_path}，将移动内容到上层 {CHROMA_DB_PATH}...")
                 
                 # 创建临时目录用于移动，避免直接移动到自身
                 temp_move_dir = CHROMA_DB_PATH + "_temp_move"
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
            # --- 嵌套目录处理结束 ---

        # 创建标记文件
        with open(flag_file, "w") as f:
            f.write("initialized")
        logging.info(f"在 {CHROMA_DB_PATH} 创建初始化标记文件")

        logging.info(f"数据库成功初始化到 {CHROMA_DB_PATH}")

    except Exception as e:
        logging.error(f"解压或设置数据库时出错: {e}")
        # 在启动阶段失败很重要，需要抛出异常
        raise

# 定义输入模型
class RetrieveDiagramsRequest(BaseModel):
    question: str = Field(..., description="用户查询")
    numResults: int = Field(TOP_K, description="要返回的结果数量")
    rerank: bool = Field(True, description="是否重新排序结果")
    context: Optional[Dict[str, Any]] = Field(None, description="可选的对话上下文")

# 定义输出文档模型，与 route.ts 中的 VectorizeDocument 结构匹配
class DiagramDocument(BaseModel):
    text: str = Field(..., description="图表的文本描述")
    filename: str = Field(..., description="文件名或标识符")
    source_display_name: str = Field(..., description="显示名称")
    svg_content: str = Field(..., description="SVG 图表内容")
    source_url: str = Field(..., description="图表来源 URL")
    metadata: Dict[str, Any] = Field(..., description="图表元数据")

# 定义响应模型，与 route.ts 中的 RetrievalContext 结构匹配
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
    allow_origins=["*"],  # 允许所有来源，可以根据需要限制
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 加载嵌入模型和数据库的函数
@app.on_event("startup")
async def startup_event():
    # 初始化全局变量
    global embedding_function, client, collection
    
    try:
        # --- 首先调用 setup_database ---
        setup_database() 
        
        logging.info(f"Loading embedding model: {MODEL_NAME}...")
        # 直接使用模型名称初始化嵌入函数，而不是先加载模型
        embedding_function = SentenceTransformerEmbeddingFunction(model_name=MODEL_NAME)
        
        logging.info(f"Initializing ChromaDB client at path: {CHROMA_DB_PATH}")
        # setup_database 应该已创建目录，这里不再需要 os.makedirs
        # os.makedirs(os.path.dirname(CHROMA_DB_PATH), exist_ok=True) # 可以移除或注释掉
        client = chromadb.PersistentClient(path=CHROMA_DB_PATH)
        
        logging.info(f"Getting collection: {COLLECTION_NAME}")
        # 获取数据集合
        collection = client.get_collection(
            name=COLLECTION_NAME
        )
        
        logging.info("Startup completed successfully.")
    except Exception as e:
        logging.error(f"Error during startup: {e}")
        raise

# 检索图表端点
@app.post("/retrieve_diagrams", response_model=DiagramRetrievalResponse)
async def retrieve_diagrams(request: RetrieveDiagramsRequest):
    try:
        logging.info(f"Received query: {request.question}")
        
        # 查询 ChromaDB 获取相关图表
        results = collection.query(
            query_texts=[request.question],
            n_results=request.numResults
        )
        
        if not results or not results['ids'] or len(results['ids'][0]) == 0:
            logging.warning("No results found for the query")
            return DiagramRetrievalResponse(documents=[])
        
        # 处理查询结果
        documents = []
        for i, doc_id in enumerate(results['ids'][0]):
            # 获取元数据和嵌入向量
            metadata = results['metadatas'][0][i] if results['metadatas'] else {}
            
            # 从元数据中提取文档信息
            svg_content = metadata.get('svg_content', '')
            text_elements = metadata.get('text_elements', [])
            original_metadata = metadata.get('metadata', {})
            
            # 构建文档描述
            description = metadata.get('description', '')
            if not description and text_elements:
                description = " ".join(text_elements)
            
            # 构建源 URL
            source_url = metadata.get('source_url', '')
            
            # 创建文档对象
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
    # 从环境变量获取端口，默认为 8000 (用于本地测试)
    port = int(os.getenv("PORT", 8000)) 
    # 移除 reload=True，不适用于生产环境
    uvicorn.run("api:app", host="0.0.0.0", port=port) 