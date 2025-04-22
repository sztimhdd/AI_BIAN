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
# 使用环境变量或默认路径
CHROMA_DB_PATH = os.getenv("CHROMA_DB_PATH", "/app/chroma_db/diagrams_db")
# 确保目录存在
os.makedirs(CHROMA_DB_PATH, exist_ok=True) 
MODEL_NAME = "all-MiniLM-L6-v2"
TOP_K = 1  # 默认返回的图表数量

def setup_database():
    """设置数据库目录和文件"""
    flag_file = os.path.join(CHROMA_DB_PATH, ".initialized")
    if os.path.exists(flag_file):
        logging.info("数据库已存在，跳过初始化")
        return

    try:
        # 尝试多个可能的位置查找压缩包
        possible_paths = [
            os.path.join(os.getcwd(), "chroma_db_diagrams.tar.gz"),  # 当前目录
            "/diagramRAG/chroma_db_diagrams.tar.gz",                        # /app 目录
            os.path.join(os.path.dirname(__file__), "chroma_db_diagrams.tar.gz")  # 脚本所在目录
        ]
        
        local_tar = None
        for path in possible_paths:
            if os.path.exists(path):
                local_tar = path
                logging.info(f"找到压缩包: {local_tar}")
                break
                
        if not local_tar:
            raise FileNotFoundError(f"找不到数据库压缩包，尝试过以下路径: {possible_paths}")
            
        temp_extract = "/tmp/extracted"
        logging.info(f"开始解压本地压缩包 {local_tar} ...")

        # 创建临时提取目录
        os.makedirs(temp_extract, exist_ok=True)

        # 解压文件
        with tarfile.open(local_tar) as tar:
            logging.info(f"压缩包内容前10项: {tar.getnames()[:10]}")
            tar.extractall(path=temp_extract)

        # 解压后记录
        logging.info(f"解压完成，临时目录内容: {os.listdir(temp_extract)}")

        # 找到压缩包中的实际数据库目录
        nested = os.path.join(temp_extract, "chroma_db_diagrams")
        if os.path.isdir(nested):
            src_path = nested
        else:
            src_path = temp_extract
        logging.info(f"源目录: {src_path}")

        # 确保目标目录存在
        os.makedirs(os.path.dirname(CHROMA_DB_PATH), exist_ok=True)

        # 复制文件到目标位置
        if os.path.exists(CHROMA_DB_PATH):
            shutil.rmtree(CHROMA_DB_PATH)
        shutil.copytree(src_path, CHROMA_DB_PATH)

        # 创建标记文件
        with open(flag_file, "w") as f:
            f.write("initialized")

        logging.info(f"数据库成功初始化到 {CHROMA_DB_PATH}")

    except Exception as e:
        logging.error(f"设置数据库时出错: {e}")
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
        # 首先设置数据库
        try:
            setup_database()
        except Exception as setup_err:
            logging.error(f"数据库设置失败: {setup_err}")
            # 继续执行，尝试使用可能已存在的数据库
        
        logging.info(f"Loading embedding model: {MODEL_NAME}...")
        # 直接使用模型名称初始化嵌入函数
        embedding_function = SentenceTransformerEmbeddingFunction(model_name=MODEL_NAME)
        
        logging.info(f"Initializing ChromaDB client at path: {CHROMA_DB_PATH}")
        # 确保父目录存在
        os.makedirs(os.path.dirname(CHROMA_DB_PATH), exist_ok=True) 
        client = chromadb.PersistentClient(path=CHROMA_DB_PATH)
        
        logging.info(f"Getting collection: {COLLECTION_NAME}")
        # 获取数据集合
        try:
            collection = client.get_collection(name=COLLECTION_NAME)
            logging.info(f"成功获取集合 {COLLECTION_NAME}")
        except Exception as coll_err:
            logging.error(f"获取集合失败: {coll_err}")
            logging.info(f"尝试创建新集合 {COLLECTION_NAME}")
            collection = client.create_collection(
                name=COLLECTION_NAME,
                embedding_function=embedding_function
            )
        
        logging.info("Startup completed successfully.")
    except Exception as e:
        logging.error(f"Error during startup: {e}")
        # 不要抛出异常，避免重启循环
        # 记录错误但让应用继续运行
        logging.error("应用将继续但可能无法正常工作")

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