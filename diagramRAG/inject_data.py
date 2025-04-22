import json
import chromadb
from sentence_transformers import SentenceTransformer
import os
import logging
import hashlib
import gc
import time
from typing import Dict, List, Generator, Tuple, Set, Any

# --- Configuration ---
SOURCE_JSON_FILE = 'bian_scraper/output.json'  # Path to the Scrapy output file
CHROMA_DB_PATH = "./chroma_db_diagrams"  # Directory to store ChromaDB data
COLLECTION_NAME = "bian_diagrams"
EMBEDDING_MODEL_NAME = 'all-MiniLM-L6-v2'
BATCH_SIZE = 5  # 处理批次大小，可根据内存情况调整
CHECKPOINT_FILE = "injection_checkpoint.json"  # 断点续传文件

# --- Logging Setup ---
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

# --- SVG Description Generation Function ---
def generate_svg_description(metadata, text_elements):
    """
    Generates a textual description for an SVG based on its metadata and text.
    """
    bizzid = metadata.get('bizzid', 'Unknown ID')
    concept = metadata.get('bizzconcept')  # Might be None
    semantic = metadata.get('bizzsemantic')  # Might be None
    description_parts = [f"BIAN Diagram ID {bizzid}."]
    if concept:
        description_parts.append(f"Primary Concept: {concept}.")
    if semantic:
        description_parts.append(f"Semantic Type: {semantic}.")
    if text_elements:
        key_texts = ", ".join(filter(None, text_elements[:15]))
        if key_texts:
            description_parts.append(f"Key elements mentioned: {key_texts}.")
    return " ".join(description_parts)

# --- Streaming JSON Processing ---
def stream_json_objects(file_path: str) -> Generator[Dict, None, None]:
    """
    流式处理大型JSON文件，一次只读取一个完整的JSON对象
    """
    logging.info(f"Starting streaming of JSON objects from {file_path}")
    
    def extract_json_object(content: str, start_pos: int) -> Tuple[Dict, int]:
        """从给定位置提取一个JSON对象，返回对象和下一个位置"""
        in_quotes = False
        escape_next = False
        brace_count = 0
        object_start = -1
        
        i = start_pos
        content_length = len(content)
        
        # 跳过开始的空白和可能的数组分隔符
        while i < content_length and (content[i].isspace() or content[i] in '[,'):
            i += 1
        
        if i >= content_length:
            return None, content_length  # 到达文件尾部
        
        # 确认我们找到了一个对象的开始
        if content[i] != '{':
            # 尝试找下一个对象
            next_obj_start = content.find('{', i)
            if next_obj_start == -1:
                return None, content_length  # 没有更多对象
            i = next_obj_start
        
        object_start = i
        brace_count = 1  # 我们已经找到了一个开始的大括号
        
        # 查找完整的对象
        i += 1
        while i < content_length and brace_count > 0:
            char = content[i]
            
            # 处理字符串内部
            if char == '"' and not escape_next:
                in_quotes = not in_quotes
            elif not in_quotes:
                if char == '{':
                    brace_count += 1
                elif char == '}':
                    brace_count -= 1
            
            # 处理转义字符
            if char == '\\' and not escape_next:
                escape_next = True
            else:
                escape_next = False
            
            i += 1
        
        if brace_count != 0:
            logging.warning("对象不完整，可能遇到JSON格式错误")
            return None, i
        
        # 提取完整的JSON对象
        json_str = content[object_start:i]
        try:
            json_obj = json.loads(json_str)
            return json_obj, i
        except json.JSONDecodeError as e:
            logging.warning(f"JSON解析错误: {e} - 在位置 {object_start} 到 {i}")
            # 跳过这个对象，继续寻找下一个
            return None, i
    
    # 读取文件并分块处理
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
            
        position = 0
        content_length = len(content)
        
        while position < content_length:
            json_obj, next_position = extract_json_object(content, position)
            if json_obj:
                yield json_obj
            
            # 确保我们前进了
            if next_position <= position:
                position += 1  # 防止无限循环
            else:
                position = next_position
            
            # 每处理一定数量的字符就触发垃圾回收
            if position % (10 * 1024 * 1024) == 0:  # 每10MB
                gc.collect()
                logging.info(f"已处理 {position/1024/1024:.2f}MB / {content_length/1024/1024:.2f}MB")
    
    except Exception as e:
        logging.error(f"文件流处理错误: {e}")
        raise

# --- 加载处理检查点 ---
def load_checkpoint() -> Set[str]:
    """加载已处理的SVG哈希值以支持断点续传"""
    processed_hashes = set()
    if os.path.exists(CHECKPOINT_FILE):
        try:
            with open(CHECKPOINT_FILE, 'r') as f:
                checkpoint_data = json.load(f)
                processed_hashes = set(checkpoint_data.get('processed_hashes', []))
            logging.info(f"加载断点续传数据: 已处理 {len(processed_hashes)} 个项目")
        except Exception as e:
            logging.warning(f"无法加载检查点文件: {e}")
    return processed_hashes

# --- 保存处理检查点 ---
def save_checkpoint(processed_hashes: Set[str]):
    """保存已处理的SVG哈希值到检查点文件"""
    try:
        with open(CHECKPOINT_FILE, 'w') as f:
            json.dump({'processed_hashes': list(processed_hashes)}, f)
        logging.info(f"保存检查点: {len(processed_hashes)} 个已处理项目")
    except Exception as e:
        logging.error(f"保存检查点失败: {e}")

# --- 处理和批量注入 ---
def process_and_inject_in_batches(model, collection, json_stream, processed_hashes):
    """批量处理和注入数据到ChromaDB"""
    # 批处理缓冲区
    ids_batch = []
    metadata_batch = []
    documents_batch = []
    
    # 统计信息
    batch_count = 0
    processed_count = 0
    skipped_count = 0
    already_processed_count = 0
    missing_count = 0
    
    # 当前处理批次
    current_batch_items = 0
    current_batch_start_time = time.time()
    
    # 已处理的哈希值（包括此次运行新处理的）
    newly_processed = set()
    
    # 处理数据流
    for item in json_stream:
        try:
            # 基本验证
            required_keys = ['source_url', 'svg_index', 'metadata', 'text_elements', 'svg_content']
            if not all(k in item for k in required_keys):
                logging.warning(f"跳过项目: 缺少必要字段 {[k for k in required_keys if k not in item]}")
                missing_count += 1
                continue
            
            # 计算SVG内容哈希
            if not item['svg_content']:
                logging.warning(f"跳过项目: SVG内容为空，来源: {item.get('source_url', 'N/A')}")
                missing_count += 1
                continue
            
            svg_hash = hashlib.sha256(item['svg_content'].encode('utf-8')).hexdigest()
            
            # 检查是否已处理过
            if svg_hash in processed_hashes:
                already_processed_count += 1
                continue
            
            # 生成描述
            description = generate_svg_description(item['metadata'], item['text_elements'])
            
            # 准备元数据
            chroma_metadata = {
                "source_url": item['source_url'],
                "svg_index": item['svg_index'],
                "bizzid": str(item['metadata'].get('bizzid', 'N/A')),
                "bizzconcept": item['metadata'].get('bizzconcept'),
                "bizzsemantic": item['metadata'].get('bizzsemantic'),
                "svg_content": item['svg_content'],
                "text_elements_preview": json.dumps(item['text_elements'][:10] if item['text_elements'] else [])
            }
            # 过滤掉空值
            chroma_metadata = {k: v for k, v in chroma_metadata.items() if v is not None}
            
            # 添加到批处理
            ids_batch.append(svg_hash)
            metadata_batch.append(chroma_metadata)
            documents_batch.append(description)
            
            # 记录新处理的哈希
            newly_processed.add(svg_hash)
            current_batch_items += 1
            
            # 当达到批处理大小时处理当前批次
            if len(ids_batch) >= BATCH_SIZE:
                process_batch(model, collection, ids_batch, metadata_batch, documents_batch)
                
                # 更新统计信息
                processed_count += len(ids_batch)
                batch_count += 1
                
                # 计算批处理速度
                batch_time = time.time() - current_batch_start_time
                items_per_second = current_batch_items / batch_time if batch_time > 0 else 0
                
                logging.info(f"批次 {batch_count} 完成: 处理了 {current_batch_items} 项 ({items_per_second:.2f} 项/秒)")
                
                # 每10个批次保存一次检查点
                if batch_count % 10 == 0:
                    processed_hashes.update(newly_processed)
                    save_checkpoint(processed_hashes)
                    
                    # 强制垃圾回收
                    gc.collect()
                    logging.info(f"已处理: {processed_count}, 跳过: {skipped_count}, 已存在: {already_processed_count}, 缺失: {missing_count}")
                
                # 重置批处理缓冲区
                ids_batch = []
                metadata_batch = []
                documents_batch = []
                current_batch_items = 0
                current_batch_start_time = time.time()
            
        except Exception as e:
            logging.warning(f"处理项目时发生错误: {e}")
            skipped_count += 1
    
    # 处理最后一个不完整的批次
    if ids_batch:
        process_batch(model, collection, ids_batch, metadata_batch, documents_batch)
        processed_count += len(ids_batch)
        batch_count += 1
    
    # 更新最终检查点
    processed_hashes.update(newly_processed)
    save_checkpoint(processed_hashes)
    
    return {
        "processed": processed_count,
        "skipped": skipped_count,
        "already_processed": already_processed_count,
        "missing": missing_count,
        "batch_count": batch_count,
        "newly_processed": len(newly_processed)
    }

def process_batch(model, collection, ids, metadatas, documents):
    """处理单个批次，计算嵌入并注入到数据库"""
    try:
        # 计算嵌入
        embeddings = model.encode(documents, show_progress_bar=False).tolist()
        
        # 注入到ChromaDB
        collection.upsert(
            ids=ids,
            embeddings=embeddings,
            metadatas=metadatas,
            documents=documents
        )
        
    except Exception as e:
        logging.error(f"批处理失败: {e}")
        raise

# --- 主执行逻辑 ---
if __name__ == "__main__":
    start_time = time.time()
    logging.info("开始数据注入过程...")
    
    # 检查源文件
    if not os.path.exists(SOURCE_JSON_FILE):
        logging.error(f"源JSON文件不存在: {SOURCE_JSON_FILE}")
        exit(1)
    
    # 加载检查点
    processed_hashes = load_checkpoint()
    
    try:
        # 初始化嵌入模型
        logging.info(f"加载嵌入模型: {EMBEDDING_MODEL_NAME}...")
        model = SentenceTransformer(EMBEDDING_MODEL_NAME)
        logging.info("嵌入模型加载成功。")
        
        # 初始化ChromaDB
        logging.info(f"初始化ChromaDB客户端，路径: {CHROMA_DB_PATH}")
        client = chromadb.PersistentClient(path=CHROMA_DB_PATH)
        
        logging.info(f"获取或创建集合: {COLLECTION_NAME}")
        collection = client.get_or_create_collection(name=COLLECTION_NAME)
        logging.info(f"使用集合 '{collection.name}' (ID: {collection.id})")
        
        # 创建JSON对象流
        json_stream = stream_json_objects(SOURCE_JSON_FILE)
        
        # 批量处理和注入
        stats = process_and_inject_in_batches(model, collection, json_stream, processed_hashes)
        
        # 显示统计信息
        total_time = time.time() - start_time
        logging.info(f"数据注入完成。总耗时: {total_time:.2f} 秒")
        logging.info(f"处理统计: 新处理 {stats['newly_processed']} 项，已存在 {stats['already_processed']} 项")
        logging.info(f"跳过统计: 错误 {stats['skipped']} 项，缺失字段 {stats['missing']} 项")
        logging.info(f"总批次: {stats['batch_count']}，平均每批处理速度: {stats['processed']/stats['batch_count'] if stats['batch_count'] > 0 else 0:.2f} 项/批")
        
        # 显示集合信息
        logging.info(f"ChromaDB 集合现有 {collection.count()} 个项目")
        
    except Exception as e:
        logging.error(f"处理过程中发生错误: {e}")
        exit(1)
    
    logging.info("数据注入过程已完成")
