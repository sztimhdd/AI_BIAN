# 图表 RAG 模块 PRD (BIAN SVG 处理)

**版本:** 1.0
**日期:** 2025年4月7日

---

## 1. 模块概述与目标

本模块是 BIAN 知识库项目的一部分，其核心目标是**专门处理来自 bian.org 网站内嵌的 SVG 图表**，并提供一个查询接口。它通过解析 SVG、提取关键元数据、生成文本描述并进行向量化，实现对 BIAN 图表内容的语义检索。

**关键目标:**

*   **数据源:** 仅处理 `bian.org` 网站 HTML 页面中嵌入的 SVG 图表。
*   **核心功能:** 实现对这些 SVG 图表的有效索引和语义查询。
*   **接口:** 提供一个清晰、简单的 API 接口，供主聊天后端 (`route.ts`) 调用，以根据用户查询检索相关的图表信息。
*   **最小化设计:** 采用最直接、必要的技术和流程，以最低成本实现核心功能。

---

## 2. 精简架构设计

本模块采用独立的 RAG 流程，与主项目的文本 RAG 管道并行运作。

```mermaid
graph TD
    subgraph "离线/批处理：数据注入"
        A[BIAN.org 爬虫] --> B{HTML 解析器<br>(BeautifulSoup + lxml)};
        B -- 提取 SVG 内容 --> C[SVG 解析器 (lxml)];
        C -- 提取元数据 & 文本 --> D[描述生成器];
        D -- 图表描述 --> E[Embedding 模型<br>(Sentence Transformers)];
        E -- 描述 Embedding & 元数据 --> F[(图表向量数据库<br>FAISS / ChromaDB / pgvector)];
    end

    subgraph "在线：查询处理"
        G[主聊天后端 (route.ts)] -- API 调用: 查询请求 --> H{图表 RAG API<br>(FastAPI/Flask)};
        H -- 查询文本 --> I[Embedding 模型<br>(与 E 相同)];
        I -- 查询 Vector --> F;
        F -- 相似性搜索 --> J[检索 Top-K 结果];
        J -- 相关图表信息<br>(描述, 元数据, SVG链接/内容) --> H;
        H -- API 响应 --> G;
    end
```

**流程说明:**

1.  **数据注入 (离线/批处理):**
    *   使用爬虫下载 `bian.org` 相关页面。
    *   使用 `BeautifulSoup` 定位 `<svg>` 标签，使用 `lxml` 解析 SVG 的 XML 结构。
    *   **关键:** 提取 SVG 内嵌的 **BIAN 特定元数据** (如 `bizzid`, `bizzsemantic`, `bizzconcept`) 以及 `<text>` 元素内容。
    *   根据提取的元数据和文本，为每个 SVG **生成一段简洁的文本描述**。
    *   使用 **Sentence Transformers** (如 `all-MiniLM-L6-v2`) 对生成的文本描述进行 Embedding。
    *   将 Embedding 向量、原始元数据、生成的描述以及指向 SVG 的链接（或 SVG 原始内容）存入一个**独立的图表向量数据库** (推荐使用 FAISS 或 ChromaDB 以简化本地开发，或与文本 RAG 统一技术栈如 pgvector)。
2.  **查询处理 (在线 API):**
    *   模块提供一个 API 端点 (例如 `/retrieve_diagrams`)。
    *   接收来自主聊天后端 (`route.ts`) 的用户查询文本和所需结果数量 (k)。
    *   使用**相同**的 Sentence Transformers 模型将查询文本进行 Embedding。
    *   在图表向量数据库中执行相似性搜索，找出与查询 Embedding 最相似的 Top-K 个图表描述。
    *   返回包含这些图表的描述、元数据和 SVG 链接/内容的列表给调用方 (`route.ts`)。

---

## 3. 核心组件与技术选型 (最小化)

*   **数据获取与解析:**
    *   `requests` / `httpx` (Python): 用于下载 HTML 页面 (替代 Scrapy 以简化)。
    *   `beautifulsoup4` (Python): 用于解析 HTML，定位 SVG 标签。
    *   `lxml` (Python): **必需**，用于高效、准确地解析 SVG (XML) 结构和提取元数据。
*   **描述生成与 Embedding:**
    *   自定义 Python 逻辑: 用于基于提取的元数据生成文本描述。
    *   `sentence-transformers` (Python): 用于生成文本描述和查询的 Embedding。
*   **向量存储与检索:**
    *   **推荐:** `faiss-cpu` (Python): 轻量级，适合本地运行和 MVP 阶段。备选 `chromadb`。
    *   (如果与文本 RAG 统一): 对应的数据库客户端 (如 `psycopg2` for pgvector)。
*   **API 服务:**
    *   `FastAPI` (Python): 轻量、高效的 Web 框架，用于提供查询 API。

---

## 4. API 接口定义 (供 `route.ts` 调用)

本模块需提供一个 HTTP POST API 端点。

**端点:** `/retrieve_diagrams`

**请求 (Request Body):**

```json
{
  "query": "用户的自然语言查询文本",
  "top_k": 3 // 需要检索的相关图表数量 (可选，默认值可设为 3)
}
```

**响应 (Response Body - 成功):**

```json
{
  "results": [
    {
      "description": "根据元数据生成的图表文本描述",
      "metadata": {
        "bizzid": "...",
        "bizzsemantic": "...",
        "bizzconcept": "...",
        // ... 其他提取的关键元数据
      },
      "svg_link": "指向原始 SVG 的 URL 或标识符", // 或 "svg_content": "<svg>...</svg>"
      "score": 0.85 // 检索得分 (可选)
    },
    // ... 其他结果 (最多 top_k 个)
  ]
}
```

**响应 (Response Body - 失败):**

```json
{
  "error": "错误描述信息"
}
```

`route.ts` 中的 `retrieveData` 函数（或一个新函数）需要调用此 API 端点，并将返回的 `results` (图表信息) 整合到发送给 LLM 的上下文中。

---

## 5. 部署考虑 (简化)

*   **数据注入:** 可以作为一次性或定期的批处理脚本在本地或服务器上运行。
*   **API 服务:** 可以作为一个独立的 Python FastAPI 应用部署，例如使用 Docker 容器化后部署到 Railway、Heroku 或其他云平台。
*   **向量数据库:** 如果使用 FAISS/ChromaDB，索引文件需要与 API 服务一起部署或存储在可访问的位置。如果使用云数据库 (如 pgvector)，则 API 服务需要配置数据库连接。

---

## 6. 移除的考虑 (精简化)

*   不再考虑除 `bian.org` 之外的数据源。
*   不实现复杂的文本块与 SVG 的自动链接逻辑 (依赖于查询时并行检索)。
*   不考虑使用多模态模型直接分析 SVG 图像 (完全依赖元数据和文本描述)。
*   简化错误处理和日志记录到满足基本调试需求即可。
*   不考虑图表创建或编辑功能。

---

## 7. API 使用指南

现已完成 diagramRAG API 的实现，提供了一个兼容于主聊天应用接口的图表检索 API。

### 启动 API 服务

1. **Windows 环境**:
   ```bash
   # 双击 run_api.bat 或在命令行中执行
   run_api.bat
   ```

2. **Linux/MacOS 环境**:
   ```bash
   # 添加执行权限并运行
   chmod +x run_api.sh
   ./run_api.sh
   ```

### API 端点说明

API 服务启动后，将在 `http://localhost:8000` 提供以下端点：

1. **`POST /retrieve_diagrams`**: 主要的图表检索端点
   - 请求格式：
     ```json
     {
       "question": "用户查询文本",
       "numResults": 5,  // 可选，默认为 5
       "rerank": true    // 可选，默认为 true
     }
     ```
   - 响应格式：
     ```json
     {
       "documents": [
         {
           "text": "图表描述文本",
           "filename": "diagram_xxx.svg",
           "source_display_name": "BIAN Diagram 标题",
           "svg_content": "<svg>...</svg>",
           "source_url": "https://bian.org/...",
           "metadata": { ... }
         },
         // ... 更多结果
       ]
     }
     ```

2. **`GET /health`**: 健康检查端点
   - 响应: `{"status": "ok"}`

### 测试 API

可以使用 Swagger UI 或 curl 来测试 API:

1. **使用 Swagger UI**: 
   - 访问 `http://localhost:8000/docs`
   - 在交互式界面中测试 `/retrieve_diagrams` 端点

2. **使用 curl**:
   ```bash
   curl -X POST "http://localhost:8000/retrieve_diagrams" \
     -H "Content-Type: application/json" \
     -d '{"question": "BIAN服务域之间的关系图", "numResults": 3}'
   ```

### 与主聊天应用集成

该 API 已设计为与主聊天应用的 `route.ts` 中的调用方式兼容。主聊天应用可以通过以下方式调用此 API：

```typescript
// 在 route.ts 中添加图表检索功能
async function retrieveDiagrams(query: string, k: number = 3): Promise<any> {
  const response = await fetch("http://localhost:8000/retrieve_diagrams", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      question: query,
      numResults: k
    }),
  });

  if (!response.ok) {
    throw new Error(`图表检索失败: ${response.status} ${response.statusText}`);
  }

  return await response.json();
}
```

---

## 8. 系统要求

- **Python 版本**: 3.8+ 
- **依赖库**: 
  - sentence-transformers
  - fastapi
  - uvicorn[standard]
  - chromadb
  - pydantic