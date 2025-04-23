import os
import shutil
import logging
from pathlib import Path
import chromadb

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)

# 常量定义 
COLLECTION_NAME = "bian_diagrams"
LOCAL_DB_PATH = "./chroma_db_diagrams"
VOLUME_MOUNT_PATH = os.getenv("CHROMA_VOLUME_MOUNT_PATH", "/data")
TARGET_DB_PATH = os.path.join(VOLUME_MOUNT_PATH, "diagrams_db")

def initialize_db():
    """将本地数据库复制到目标 Volume 路径"""
    logging.info("开始初始化数据库...")
    
    # 确保目标目录存在
    os.makedirs(TARGET_DB_PATH, exist_ok=True)
    
    # 检查目标目录是否已有数据
    try:
        client = chromadb.PersistentClient(path=TARGET_DB_PATH)
        collections = client.list_collections()
        for collection in collections:
            if collection.name == COLLECTION_NAME:
                collection_info = client.get_collection(COLLECTION_NAME)
                count = collection_info.count()
                if count > 0:
                    logging.info(f"目标数据库已存在且包含 {count} 条记录，无需初始化")
                    return False
    except Exception as e:
        logging.warning(f"检查目标数据库时出错: {e}")
    
    # 检查源数据库是否存在
    if not os.path.exists(LOCAL_DB_PATH):
        logging.error(f"源数据库路径 {LOCAL_DB_PATH} 不存在!")
        return False
    
    try:
        # 复制数据库文件
        logging.info(f"正在将数据从 {LOCAL_DB_PATH} 复制到 {TARGET_DB_PATH}...")
        
        # 先清空目标目录
        if os.path.exists(TARGET_DB_PATH):
            for item in os.listdir(TARGET_DB_PATH):
                item_path = os.path.join(TARGET_DB_PATH, item)
                try:
                    if os.path.isfile(item_path):
                        os.unlink(item_path)
                    elif os.path.isdir(item_path):
                        shutil.rmtree(item_path)
                except Exception as e:
                    logging.error(f"清除目标目录时出错: {e}")
        
        # 复制所有文件和子目录
        for item in os.listdir(LOCAL_DB_PATH):
            s = os.path.join(LOCAL_DB_PATH, item)
            d = os.path.join(TARGET_DB_PATH, item)
            if os.path.isdir(s):
                shutil.copytree(s, d, dirs_exist_ok=True)
            else:
                shutil.copy2(s, d)
        
        logging.info("数据库初始化成功!")
        return True
    except Exception as e:
        logging.error(f"复制数据库文件时出错: {e}")
        return False

if __name__ == "__main__":
    initialize_db()
