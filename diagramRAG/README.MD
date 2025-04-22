# 图表 RAG 模块 PRD (BIAN SVG 处理) - v1.2

**版本:** 1.2 (架构更新为延迟图表检索)
**日期:** 2025年4月21日

---

## 1. 模块概述与目标 (无变化)

本模块是 BIAN 知识库项目的一部分，其核心目标是**专门处理来自 bian.org 网站内嵌的 SVG 图表**，并提供一个查询接口。它通过解析 SVG、提取关键元数据、生成文本描述并进行向量化，实现对 BIAN 图表内容的语义检索。

**关键目标:**

*   **数据源:** 仅处理 `bian.org` 网站 HTML 页面中嵌入的 SVG 图表。
*   **核心功能:** 实现对这些 SVG 图表的有效索引和语义查询。
*   **接口:** 提供一个清晰、简单的 API 接口，供主聊天后端 (`route.ts`) 调用，以根据LLM分析后生成的关键词检索相关的图表信息。
*   **最小化设计:** 采用最直接、必要的技术和流程，以最低成本实现核心功能。

---

## 2. 架构设计 (方案B - 延迟图表检索)

本模块作为图表检索引擎，在主聊天应用的多阶段处理流程中被调用。

```mermaid
graph LR
    subgraph "主聊天后端 (route.ts)"
        A[用户提问] --> B(Gemini: 查询重写);
        B --> C{文本 RAG + Web Grounding};
        C --> D(Gemini: 初步答案生成);
        D --> E(Gemini: 图表需求分析 + 关键词生成);
        E -- 图表查询关键词 --> F{图表 RAG API 调用};
        F -- 返回图表数据 --> G(Gemini: 最终答案重写 + 图表融合);
        G --> H[返回给用户的答案 (含图表引用)];
    end

    subgraph "图表 RAG 模块 (diagramRAG)"
        I[(ChromaDB: 图表向量库)] <-- 查询 -- J[FastAPI: /retrieve_diagrams];
        F --> J;
        J -- 检索结果 --> F;
    end

    style F fill:#f9f,stroke:#333,stroke-width:2px
```

**流程说明 (新流程 - 方案B):**

1.  **主聊天后端 (`route.ts`) 处理流程:**
    *   接收用户自然语言提问。
    *   调用 Gemini API 进行**查询重写**，优化为 BIAN 专业术语。
    *   使用重写后的查询，**并行**调用文本 RAG (Vectorize) 和执行 Web Grounding。
    *   调用 Gemini API，结合文本 RAG 和 Web Grounding 结果，生成**初步答案**。
    *   **(新步骤)** 调用 Gemini API 分析初步答案，判断是否需要 BIAN 图表来增强回答，如果需要，则生成用于查询图表的**关键词**。
    *   **(新步骤)** 如果生成了图表关键词，则调用**本图表 RAG 模块**的 `/retrieve_diagrams` API，使用这些关键词进行检索。
    *   **(新步骤)** 调用 Gemini API 进行**最终答案重写**，将检索到的图表信息（通过文本引用的方式）融合到初步答案中。
    *   将最终的文本答案（包含图表引用）和相关的图表 SVG 数据流式传输给前端。
2.  **图表 RAG 模块 (`diagramRAG`) 职责:**
    *   **数据注入 (离线/批处理 - `inject_data.py`):** (与 v1.1 描述一致) 使用 Scrapy+Playwright 爬取 SVG，提取元数据，生成描述，使用 Sentence Transformers 进行 Embedding，基于内容哈希去重，并将结果存入 ChromaDB。采用流式处理、批量注入和断点续传。
    *   **查询处理 (在线 API - `api.py`):** 提供 `/retrieve_diagrams` 端点，接收**由主应用LLM生成的关键词**，使用 Sentence Transformers Embedding 在 ChromaDB 中执行相似性搜索，返回匹配的图表描述、元数据和 SVG 原始内容。**此 API 不负责查询重写或答案生成。**

---

## 3. 核心组件与技术选型 (已实现 - 无变化)

*   **数据获取与解析:** `Scrapy`, `scrapy-playwright`, `lxml`, `beautifulsoup4`
*   **描述生成与 Embedding:** 自定义 Python 逻辑, `sentence-transformers` (`all-MiniLM-L6-v2`)
*   **向量存储与检索:** `chromadb`
*   **API 服务:** `FastAPI`, `uvicorn`
*   **数据模型:** `Pydantic`

---

## 4. API 接口定义 (基于 `api.py` 实现 - 无变化)

**端点:** `POST /retrieve_diagrams`

**请求 (Request Body - `RetrieveDiagramsRequest` Pydantic 模型):**

```json
{
  // 'question' 字段现在预期接收的是LLM生成的关键词，而非用户原始问题或重写后的查询
  "question": "LLM生成的图表查询关键词 (例如: 'Customer Onboarding interaction, Party Lifecycle')",
  "numResults": 5,  // 可选, 默认值在 api.py 中定义 (当前为 1)
  "rerank": true,    // 可选, 默认 true (当前 ChromaDB 查询未使用此参数)
  "context": null   // 可选, 对话上下文 (当前 API 未使用此参数)
}
```

**响应 (Response Body - 成功 - `DiagramRetrievalResponse` Pydantic 模型):**

```json
{
  "documents": [ // 注意: 键是 "documents"
    {
      // DiagramDocument Pydantic 模型
      "text": "根据元数据生成的图表文本描述",
      "filename": "diagram_<svg_hash>.svg", // 基于 SVG 哈希值生成的内部文件名
      "source_display_name": "BIAN Diagram 标题 或 默认标题",
      "svg_content": "<svg>...</svg>",      // SVG 的原始内容字符串
      "source_url": "https://bian.org/...\", // 原始页面 URL
      "metadata": {                     // 原始提取的 BIAN 元数据
        "bizzid": \"...\",
        "bizzconcept": \"...\",
        "bizzsemantic": \"...\"
        // ... 其他原始元数据
      }
    },
    // ... 其他结果 (最多 numResults 个)
  ]
}
```

**响应 (Response Body - 失败):** (无变化)

```json
{
  "detail": "错误描述信息"
}
```

**集成说明:**

*   主聊天后端 (`route.ts`) 在生成初步答案后，调用 LLM 分析是否需要图表并生成关键词。
*   `route.ts` 使用这些**关键词**调用此 `/retrieve_diagrams` 端点。
*   `route.ts` 接收返回的 `documents` 列表，并将其与初步答案一起传递给 LLM进行最终答案的重写和融合。

---

## 5. 运行与部署 (无变化)

*   **数据注入 (`inject_data.py`):** (同 v1.1)
*   **API 服务 (`api.py`):** (同 v1.1)
*   **向量数据库 (`chromadb`):** (同 v1.1)

---

## 6. 系统要求 (无变化)

*   **Python 版本**: 3.8+
*   **依赖库**: `fastapi`, `uvicorn[standard]`, `chromadb`, `sentence-transformers`, `pydantic`, `lxml`, `beautifulsoup4`, `Scrapy`, `scrapy-playwright`, `playwright`

---

## 7. API 使用指南 (已实现 - 无变化)

(此部分保持不变，描述如何启动和测试本 API 模块本身)

---

## 8. 移除的考虑 (更新)

*   不再考虑除 `bian.org` 之外的数据源。
*   不实现复杂的文本块与 SVG 的自动链接逻辑 (依赖于查询时并行检索 和 LLM 的最终融合)。
*   不考虑使用多模态模型直接分析 SVG 图像 (完全依赖元数据和文本描述)。
*   **本 API 模块不执行查询重写或答案生成，其职责仅限于根据输入文本（关键词）检索并返回相关图表数据。**
*   **主应用采用多阶段LLM调用流程，可能导致较高的延迟和API成本，这是为了实现更智能的图表按需推荐和融合。**
*   不考虑图表创建或编辑功能。