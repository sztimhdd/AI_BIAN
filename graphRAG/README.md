# 知识图谱RAG模块 PRD (BIAN GraphRAG) - v1.0

**版本:** 1.0 (初始设计版本)
**日期:** 2025年5月15日

---

## 1. 模块概述与目标

本模块是 BIAN 知识库项目的新增组件，作为现有双RAG+Web Grounding架构的补充，旨在提供结构化知识图谱查询能力。通过构建BIAN领域知识图谱、实现Text2Cypher转换和子图检索，为复杂的结构化查询提供更精准的答案，特别是处理实体关系类问题时具有显著优势。

**关键目标:**

* **核心功能:** 实现基于BIAN领域本体的知识图谱构建、查询和推理
* **查询增强:** 通过图结构捕获BIAN服务域间复杂关系，提供传统向量检索难以处理的结构化答案
* **三重RAG协同:** 与现有文本RAG和图表RAG形成互补，构建更全面的知识检索体系
* **接口设计:** 提供与主聊天后端（route.ts）无缝集成的API接口
* **技术选型:** 采用NebulaGraph作为图数据库，结合LlamaIndex的知识图谱工具

---

## 2. 架构设计 

本模块作为三重RAG架构中的知识图谱路径，在主聊天应用的流程中被调用。

```mermaid
graph TD
    subgraph "用户交互"
        User[用户] --> UI[Next.js前端]
    end
    
    subgraph "主聊天后端 (route.ts)"
        UI --> B[查询接收与处理]
        B --> C[查询改写 (Gemini)]
        C --> D{查询路由决策}
        
        D -->|文本知识| E[文本RAG (Vectorize)]
        D -->|结构化关系| F[GraphRAG 调用]
        D -->|实时信息| G[Web搜索 (Gemini)]
        D -->|图表需求| H[图表RAG]
        
        E --> I[响应融合与生成]
        F --> I
        G --> I
        H --> I
        
        I --> UI
    end
    
    subgraph "知识图谱RAG模块 (graphRAG)"
        F --> J[Text2Cypher转换]
        J --> K[(NebulaGraph 图数据库)]
        K --> L[子图结构化处理]
        L --> F
    end
    
    style F fill:#f9f,stroke:#333,stroke-width:2px
    style K fill:#ccf,stroke:#333,stroke-width:2px
```

**核心流程:**

1. **主聊天后端处理流程:**
   * 接收用户自然语言问题
   * 使用Gemini进行查询改写和类型分析
   * 根据问题类型路由至不同RAG路径
   * 并行调用适用的RAG路径（可能是部分或全部）
   * 收集各路径结果并进行融合
   * 生成最终答案并返回

2. **知识图谱RAG模块职责:**
   * 接收结构化查询请求
   * 使用LLM将自然语言转换为Cypher图查询
   * 执行图数据库查询并获取相关子图
   * 将子图数据格式化为结构化JSON
   * 返回结构化关系数据给主后端

---

## 3. API接口定义

### 3.1 主要端点

**端点:** `POST /api/graph-query`

**请求 (Request Body):**

```json
{
  "query": "联络中心管理与哪些服务域直接交互?", 
  "originalQuery": "告诉我联络中心管理服务域的上下游关系",
  "queryType": "relationship", 
  "entities": ["联络中心管理"], 
  "maxHops": 2,
  "limit": 10,
  "includeMetadata": true
}
```

**参数说明:**
* `query`: 经过改写的查询文本（必需）
* `originalQuery`: 原始用户查询（可选）
* `queryType`: 查询类型标识，可选值：relationship/definition/listing/comparison（可选）
* `entities`: 主实体名称数组（可选）
* `maxHops`: 最大关系跳数，默认为1（可选）
* `limit`: 返回结果数量限制，默认为5（可选）
* `includeMetadata`: 是否包含详细元数据，默认为true（可选）

**响应 (Response Body - 成功):**

```json
{
  "status": "success",
  "data": {
    "nodes": [
      {
        "id": "node1",
        "type": "ServiceDomain",
        "name": "联络中心管理",
        "properties": { 
          "description": "...",
          "category": "交互"
        }
      },
      {
        "id": "node2", 
        "type": "ServiceDomain",
        "name": "客户数据管理",
        "properties": { ... }
      }
    ],
    "relationships": [
      {
        "source": "node1",
        "target": "node2",
        "type": "INTERACTS_WITH",
        "properties": {
          "description": "通过获取客户信息进行交互",
          "direction": "outgoing"
        }
      }
    ],
    "metadata": {
      "queryTime": "10ms",
      "nodeCount": 5,
      "relationshipCount": 4
    }
  }
}
```

**响应 (Response Body - 失败):**

```json
{
  "status": "error",
  "error": {
    "code": "GRAPH_QUERY_ERROR",
    "message": "无法在知识图谱中找到实体: XYZ服务域"
  }
}
```

### 3.2 辅助端点

**健康检查:** `GET /api/graph-query/health`
**图谱统计:** `GET /api/graph-query/stats`

---

## 4. 与route.ts集成方案

为将GraphRAG模块整合至现有架构，需要在route.ts中进行以下修改：

### 4.1 查询类型分析

在查询改写步骤后，添加查询类型分析逻辑：

```typescript
// 添加到现有流程中 - 查询类型分析
const queryTypePrompt = `
# ROLE
You are a query type classifier for BIAN banking architecture questions.

# TASK
Analyze the question and classify it into one of the following types:
1. relationship - Questions about how entities connect or interact
2. definition - Questions asking for explanations/definitions
3. listing - Questions asking for listings/enumerations
4. comparison - Questions comparing multiple concepts
5. other - General questions that don't fit above categories

# INPUT
Query: "${rewrittenQuery}"

# OUTPUT
Return ONLY a JSON object with the following structure. NO extra text.
{
  "queryType": "relationship|definition|listing|comparison|other",
  "entities": ["Entity1", "Entity2"],
  "needsGraphQuery": true|false,
  "reasoning": "Brief explanation"
}
`;

const typeAnalysisResult = await generativeModel.generateContent(queryTypePrompt);
const queryAnalysis = JSON.parse(typeAnalysisResult.response.text());
```

### 4.2 条件性GraphRAG调用

基于查询分析结果，决定是否调用GraphRAG：

```typescript
// 条件性调用GraphRAG
let graphQueryResults = null;
if (queryAnalysis.needsGraphQuery) {
  try {
    graphQueryResults = await callGraphRAG({
      query: rewrittenQuery,
      originalQuery: originalUserQuestion,
      queryType: queryAnalysis.queryType,
      entities: queryAnalysis.entities,
      maxHops: queryAnalysis.queryType === "relationship" ? 2 : 1,
      limit: 10
    });
    console.log(`图谱查询成功，返回 ${graphQueryResults.data.nodes.length} 个节点和 ${graphQueryResults.data.relationships.length} 个关系`);
  } catch (graphError) {
    console.error("图谱查询失败:", graphError);
    // 错误处理但继续流程
  }
}
```

### 4.3 响应融合增强

在初步答案生成步骤添加图谱数据：

```typescript
// 准备包含图谱数据的提示词
const initialAnswerPrompt = `
# ROLE
You are an expert BIAN specialist with deep knowledge of banking architectures.

# TASK
Provide a comprehensive answer about BIAN, incorporating document excerpts, 
${graphQueryResults ? 'relationship data from the knowledge graph,' : ''} 
and web search results.

# INPUT
User's Original Question: "${originalUserQuestion}"

${formattedDocuments ? `Provided Document Excerpts:
<chunks>
${formattedDocuments}
</chunks>` : ''}

${graphQueryResults ? `Knowledge Graph Data:
<graph-data>
${JSON.stringify(graphQueryResults.data, null, 2)}
</graph-data>` : ''}

# OUTPUT
Generate a comprehensive BIAN answer, citing all used sources appropriately.
`;
```

---

## 5. 知识图谱构建

### 5.1 数据源与领域本体

主要数据来源：
* BIAN Service Landscape 12.0 文档
* BIAN网站服务域详情页面 
* 服务域关系SVG图表
* BIAN专家输入的核心关系

领域本体设计：
* **实体类型**: ServiceDomain, BusinessObject, ControlRecord, ServiceOperation
* **关系类型**: AGGREGATED_BY, ASSOCIATED_WITH, GETS_INPUT_FROM, IS_PART_OF, REALIZED_BY, MANAGES, PROVIDES

### 5.2 三元组提取与存储

采用混合方式构建：
1. **自动提取**: 使用LLM从BIAN文档和网站内容中提取三元组
2. **图表分析**: 从SVG图表中解析服务域关系
3. **手动补充**: 添加核心概念和关键关系
4. **三元组验证**: 使用规则和LLM验证提取的三元组质量
5. **图数据库存储**: 使用NebulaGraph存储和管理三元组

示例三元组：
```
(联络中心管理, MANAGES, 客户互动)
(联络中心管理, ASSOCIATED_WITH, 客户数据管理)
(客户互动, HAS_CONTROL_RECORD, 互动记录)
```

---

## 6. 技术栈选型

| 组件 | 技术选择 | 理由 |
|-----|---------|-----|
| 图数据库 | NebulaGraph | 开源、高性能、符合BIAN复杂关系建模需求 |
| 三元组提取 | LlamaIndex + 自定义提示模板 | 良好的LLM集成，专为知识提取优化 |
| Text2Cypher | Gemini Pro + 特定提示工程 | 高质量自然语言到图查询转换 |
| API服务 | FastAPI | 高性能异步处理，易于与主系统集成 |
| 部署 | Railway (与主系统同部署) | 简化基础设施管理，降低延迟 |

---

## 7. 实施路线图

1. **阶段一：基础知识图谱构建 (当前)**
   * BIAN服务域实体及核心关系构建
   * 基础API设计与开发
   * 与route.ts的初步集成

2. **阶段二：查询增强与优化**
   * 实现更复杂的查询转换能力
   * 添加多跳查询和路径分析
   * 优化查询路由和结果融合

3. **阶段三：高级特性**
   * 添加推理能力
   * 实现图谱可视化接口
   * 开发半自动图谱扩展机制

---

## 8. 性能与集成考虑

* **延迟控制**: 图查询响应时间目标 < 500ms
* **错误处理**: 实现图谱查询失败时的平滑降级机制
* **缓存策略**: 常见实体和关系查询结果缓存
* **并行处理**: 确保与其他RAG路径并行执行不产生阻塞
* **资源估计**: 初期图谱规模约 1000 节点, 3000 关系
* **扩展性**: 设计支持图谱持续增长和复杂度提升

---

## 9. 成功标准

* **准确性**: 关系类查询的准确率提升 20%+
* **覆盖率**: 涵盖 BIAN 12.0 中全部服务域及其关键关系
* **性能**: 95% 的查询响应时间 < 1 秒
* **结果质量**: 通过 A/B 测试证明知识图谱增强显著提升用户满意度
* **集成度**: 与现有RAG系统的无缝协作，提供统一的用户体验
