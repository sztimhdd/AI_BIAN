# AI_BIAN 极简问答系统

## 架构设计
```mermaid
graph TD
    A[用户] --> B(HTML页面)
    B --> C{Railway服务}
    C --> D[术语处理]
    D --> E[Vectorize.io]
    D --> F[Gemini Pro]
    E --> G[组合响应]
    F --> G
    G --> B
    
    D --> H[BIAN术语网站]
    style H fill:#f9f,stroke:#333
```

## 核心数据流
```mermaid
sequenceDiagram
    participant U as 用户
    participant F as 前端
    participant R as Railway
    participant V as Vectorize
    participant G as Gemini
    participant B as BIAN网站

    U->>F: 输入问题
    F->>R: POST /ask
    R->>R: 术语预处理
    R->>B: 获取术语定义
    B-->>R: 返回术语
    R->>G: 优化问题
    G-->>R: 标准问题
    R->>V: 检索文档
    V-->>R: 相关段落
    R->>G: 生成答案
    G-->>R: 答案文本
    R->>F: 组合响应
    F->>U: 显示结果
```

## 功能矩阵
| 模块        | 职责                      | 技术方案                | 响应目标 |
|-------------|--------------------------|-----------------------|--------|
| 前端        | 问题输入/结果显示          | 静态HTML              | <1s    |
| Railway服务 | 流程协调                  | Node.js单文件         | <300ms |
| 术语处理    | 问题标准化                | 术语缓存+Gemini优化    | <200ms |
| 检索        | 文档匹配                  | Vectorize.io RAG      | <1s    |
| 生成        | 答案生成                  | Gemini Pro            | <1.5s  |

## 部署清单
```text
1. 前端托管: Railway静态托管
2. 服务文件: server.js (包含以下处理)
   ├─ 术语预处理
   ├─ 问答流程
   └─ 错误处理
3. 环境变量:
   ├─ GEMINI_KEY
   ├─ VECTORIZE_KEY
   └─ TERM_CACHE_KEY
```

## 演进路线
```mermaid
gantt
    title 实施路线图
    dateFormat  YYYY-MM-DD
    section 核心功能
    基础架构       :done, des1, 2024-02-20, 1d
    术语集成       :active, des2, 2024-02-21, 2d
    测试验证       : des3, after des2, 3d
    section 扩展能力
    性能优化       : des4, after des3, 2d
    监控告警       : des5, after des4, 2d
```

## 项目功能说明
本项目是一个集成了RAG（Retrieval-Augmented Generation）管线的问答系统，主要功能包括：

1. **用户输入与结果显示**：用户通过前端界面输入问题，系统将返回相应的答案。
2. **术语处理**：系统会对用户输入的问题进行术语标准化处理，以提高检索的准确性。
3. **文档检索**：通过Vectorize.io API，系统能够从相关文档中检索信息。
4. **答案生成**：使用Gemini Pro生成最终的答案，并将其返回给用户。
5. **错误处理**：系统具备完善的错误处理机制，确保在出现问题时能够给出友好的提示。

该版本实现：
✅ 最小核心功能：问答+术语处理  
✅ 单文件服务架构  
✅ 三方服务集成（Gemini+Vectorize+Railway）  
✅ 自动术语更新 