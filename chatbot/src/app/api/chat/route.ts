import { CoreMessage } from "ai";
// import { StreamingTextResponse } from "@ai-sdk/core";
// import { openai } from "@ai-sdk/openai"; // 移除 OpenAI 导入
// import { groq } from "@ai-sdk/groq"; // 移除 Groq 导入
import { 
  GoogleGenerativeAI, 
  HarmCategory, 
  HarmBlockThreshold,
  GroundingChunk as ApiGroundingChunk,
  GroundingSupport as ApiGroundingSupport,
  SearchEntryPoint
} from "@google/generative-ai"; // 导入API类型

// Define the structure of a document returned from the Vectorize API
interface VectorizeDocument {
  text: string;
  filename: string;
  source_display_name: string;
  [key: string]: any; // Allow for additional properties
}

// Define the structure of the context returned from retrieveData
interface RetrievalContext {
  documents?: VectorizeDocument[];
  [key: string]: any; // Allow for additional properties
}

// 定义图表文档的结构
interface DiagramDocument {
  text: string;
  filename: string;
  source_display_name: string;
  svg_content: string;
  source_url: string;
  metadata: Record<string, any>;
  [key: string]: any;
}

// 定义图表检索结果的结构
interface DiagramRetrievalResponse {
  documents: DiagramDocument[];
}

// 使用API提供的类型定义简化自定义接口
interface GroundingMetadata {
  searchEntryPoint?: SearchEntryPoint;
  groundingChunks?: ApiGroundingChunk[];
  groundingSupports?: ApiGroundingSupport[];
  webSearchQueries?: string[];
}

// 定义图表分析结果的结构
interface DiagramAnalysisResult {
  needDiagram: boolean;
  keywords: string;
  reasoning: string;
}

export async function POST(req: Request) {
  try {
    const { messages }: { messages: CoreMessage[] } = await req.json();
    const model = process.env.MODEL;
    const llmProvider = process.env.LLM_PROVIDER?.toLowerCase(); // Convert to lowercase for case-insensitive comparison

    if (!model) {
      return new Response(
        JSON.stringify({
          error: "MODEL is not set in the environment variables. Please add it to your environment settings (e.g. .env.develoment) file."
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!llmProvider || llmProvider !== "google") {
      return new Response(
        JSON.stringify({
          error: "LLM_PROVIDER is not set or has an invalid value. Please set it to 'google' in your environment settings."
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
    
    // Check for provider-specific API keys
    const requiredApiKey = process.env.GEMINI_API_KEY;
    
    if (!requiredApiKey) {
      return new Response(
        JSON.stringify({
          error: "GEMINI_API_KEY is not set in the environment variables. Please add it to your environment settings."
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Create Google Generative AI client
    const genAI = new GoogleGenerativeAI(requiredApiKey);
    // 更新为使用环境变量定义的模型并启用Web Grounding
    const generativeModel = genAI.getGenerativeModel({ 
      model: model,  // 使用环境变量中的MODEL值
      generationConfig: {
        temperature: 0.7,
      },
      safetySettings: [
        {
          category: HarmCategory.HARM_CATEGORY_HARASSMENT,
          threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
          threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
          threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
          threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
        },
      ],
      // 启用Google Search工具
      tools: [
        {
          // @ts-ignore - API类型定义可能尚未更新，但功能可用
          googleSearch: {}
        }
      ]
    }); 

    // Receive User Query: Extract the original user question
    if (messages.length === 0) {
      return new Response(
        JSON.stringify({
          error: "No messages provided"
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
    
    const originalUserQuestion = String(messages[messages.length - 1].content);
    
    // Query Rewriting (for RAG): Transform user's question into optimized query
    let rewrittenQuery = originalUserQuestion; // Default fallback
    
    try {
      // Prepare the query rewriting prompt
      const queryRewritingPrompt = `
# ROLE
You are an expert query transformation assistant specializing in the BIAN domain.

# TASK
Transform the user's natural language question into a precise English query optimized for BIAN document retrieval.

# REQUIREMENTS
- Focus on key BIAN concepts, technical terms, Service Domains, or Service Operations
- Preserve the core semantic meaning and intent
- Remove conversational fillers and unnecessary context
- Output only the rewritten query string, with no preamble or explanation

# INPUT
Original User Question: "${originalUserQuestion}"

# OUTPUT
Output only the rewritten English query string.
`;

      // Call Gemini for query rewriting
      const rewriteResult = await generativeModel.generateContent(queryRewritingPrompt);
      
      if (rewriteResult && rewriteResult.response) {
        const rewriteText = rewriteResult.response.text();
        if (rewriteText && rewriteText.trim()) {
          rewrittenQuery = rewriteText.trim();
          console.log(`Rewritten query for RAG: "${rewrittenQuery}"`);
        } else {
          console.warn("Received empty rewritten query, falling back to original question");
        }
      }
    } catch (rewriteError) {
      console.error("Error during query rewriting:", rewriteError);
      console.log("Falling back to original user question for retrieval");
    }

    // RAG Retrieval: Use the rewritten query to retrieve relevant documents
    let context: RetrievalContext | null = null;
    
    try {
      const previousMessages = messages.slice(0, -1);
      // Use rewrittenQuery instead of original question for retrieval
      context = await retrieveData(rewrittenQuery, previousMessages);
    } catch (retrieveError: any) {
      return new Response(
        JSON.stringify({
          error: retrieveError.message || "Failed to retrieve context data"
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // ===== 方案B：第一次Gemini调用 (生成初步答案) =====
    console.log("生成初步答案...");
    
    // 格式化检索到的文档，准备用于LLM提示
    let formattedDocuments = "";
    let documentSources: {title: string, link: string}[] = [];
    
    if (context && context.documents) {
      // 保存文档源信息以便后续添加引用
      documentSources = context.documents.map((doc, index) => {
        // 改进文档链接提取和标准化逻辑
        let docLink;
        
        // 1. 先尝试从文档直接属性获取链接
        if (doc.source_url || doc.url || doc.link || doc.document_url) {
          docLink = doc.source_url || doc.url || doc.link || doc.document_url;
        } 
        // 2. 再尝试从元数据中获取
        else if (doc.metadata && (doc.metadata.url || doc.metadata.source_url || doc.metadata.link)) {
          docLink = doc.metadata.url || doc.metadata.source_url || doc.metadata.link;
        } 
        // 3. 如果以上方法都失败，则构建默认链接
        else {
          // 提取文档标识符用于链接构建
          let docIdentifier;
          
          // 尝试从文件名或显示名获取标识符
          if (doc.source_display_name) {
            docIdentifier = doc.source_display_name;
          } else if (doc.filename) {
            // 从文件名中去除扩展名和路径
            docIdentifier = doc.filename.replace(/\.[^/.]+$/, "").split('/').pop();
          } else {
            docIdentifier = `document-${index+1}`;
          }
          
          // 对标识符进行URL编码和格式化
          const encodedIdentifier = encodeURIComponent(
            docIdentifier.toLowerCase().replace(/\s+/g, '-')
          );
          
          // 构建BIAN标准化链接格式
          docLink = `https://bian.org/servicelandscape/reference/${encodedIdentifier}`;
        }
        
        // 改进文档标题提取逻辑，更好地处理文档名称
        let docTitle;
        
        if (doc.source_display_name) {
          // 如果有显示名称，直接使用
          docTitle = doc.source_display_name;
        } else if (doc.filename) {
          // 从文件名中提取更好的标题（去除扩展名和格式化）
          const rawName = doc.filename.replace(/\.[^/.]+$/, "").split('/').pop();
          
          // 尝试将下划线和连字符转换为空格，并添加适当的大小写
          docTitle = rawName
            ?.replace(/[_-]/g, ' ')
            ?.replace(/\b\w/g, l => l.toUpperCase()) || `BIAN Document ${index + 1}`;
        } else {
          // 默认标题
          docTitle = `BIAN Document ${index + 1}`;
        }
        
        return {
          title: docTitle,
          link: docLink
        };
      });
      
      // Format documents for the prompt
      formattedDocuments = context.documents.map((doc, index) => {
        const sourceId = `source=${index + 1}&link=${documentSources[index].link}`;
        return `[${sourceId}]\n${doc.text}`;
      }).join('\n\n');
    }

    // ===== 方案B：第一次Gemini调用 (生成初步答案) =====
    console.log("生成初步答案...");
    
    // 准备初步答案生成的提示词
    const initialAnswerPrompt = `
# ROLE
You are an expert BIAN (Banking Industry Architecture Network) specialist with deep knowledge of banking architectures and financial technology standards.

# TASK
Provide a comprehensive, accurate, and professional answer about BIAN, covering frameworks, service domains, implementation methods, and related aspects.

# REQUIREMENTS
- Synthesize information from:
  1. Your internal BIAN knowledge base
  2. The provided document excerpts 
  3. Latest information obtained through Google search
- Prioritize accuracy and professionalism
- Always use proper citations when referencing information:
  - For BIAN documents: use [Doc#] format
  - For web references: use appropriate citations
- Structure your answer with clear headings, lists, and tables for improved readability
- Include relevant examples where appropriate
- Provide a concise but comprehensive answer in English
- Use web search to find answers if you're uncertain or need more information

# INPUT
User's Original Question: "${originalUserQuestion}"

Provided Document Excerpts:
<chunks>
${formattedDocuments}
</chunks>

# OUTPUT
Generate a comprehensive and authoritative BIAN-related answer, with appropriate citations to reliable sources. Use web search for additional information when needed.
`;

    // 调用Gemini生成初步答案
    const initialResult = await generativeModel.generateContent(initialAnswerPrompt);
    console.log(`初步答案生成完成`);
    
    // 提取初步答案内容和Web Grounding信息
    let initialAnswer = "";
    let groundingData: GroundingMetadata | null = null;

    if (initialResult && initialResult.response) {
      try {
        if (initialResult.response.candidates && initialResult.response.candidates.length > 0) {
          const candidate = initialResult.response.candidates[0];
          
          // 提取响应文本
          if (candidate?.content?.parts?.length > 0) {
            initialAnswer = candidate.content.parts
              .map(part => {
                try {
                  const anyPart = part as any;
                  if (typeof anyPart.text === 'string') {
                    return anyPart.text;
                  } else if (anyPart.text && typeof anyPart.text === 'object' && typeof anyPart.text.toString === 'function') {
                    return anyPart.text.toString();
                  }
                } catch (e) {
                  console.warn("Error accessing part.text:", e);
                }
                return '';
              })
              .filter(text => text)
              .join('\n');
          }
          
          // 如果初步答案为空，尝试其他方法提取
          if (!initialAnswer || initialAnswer.trim() === '') {
            console.warn("Empty initialAnswer extracted from Gemini API");
            
            try {
              const anyContent = candidate.content as any;
              if (anyContent && typeof anyContent.text === 'function') {
                initialAnswer = anyContent.text();
              }
            } catch (e) {
              console.warn("Error accessing content.text:", e);
            }
            
            try {
              const anyCandidate = candidate as any;
              if (anyCandidate && typeof anyCandidate.text === 'function') {
                initialAnswer = anyCandidate.text();
              }
            } catch (e) {
              console.warn("Error accessing candidate.text:", e);
            }
          }
          
          // 提取Web Grounding元数据
          if (candidate?.groundingMetadata) {
            groundingData = {
              searchEntryPoint: candidate.groundingMetadata.searchEntryPoint,
              groundingChunks: candidate.groundingMetadata.groundingChunks,
              groundingSupports: candidate.groundingMetadata.groundingSupports,
              webSearchQueries: candidate.groundingMetadata.webSearchQueries,
            };
          }
        } else if (initialResult.response.text && typeof initialResult.response.text === "function") {
          initialAnswer = initialResult.response.text();
        } else if (typeof initialResult.response === "string") {
          initialAnswer = initialResult.response;
        } else {
          try {
            initialAnswer = JSON.stringify(initialResult.response);
          } catch (stringifyError) {
            console.error("Error stringifying response:", stringifyError);
            throw new Error("Cannot extract text from response in any way");
          }
        }
      } catch (extractionError: unknown) {
        console.error("Error extracting text from Gemini response:", extractionError);
        return new Response(
          JSON.stringify({
            error: `Failed to extract text from ${model} API response: ${extractionError instanceof Error ? extractionError.message : 'Unknown error'}`
          }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }

    // 确保我们有有效的初步答案
    if (!initialAnswer || initialAnswer.trim() === "") {
      console.error("All extraction methods failed, no valid text extracted from API for initial answer");
      return new Response(
        JSON.stringify({
          error: "Failed to generate initial answer."
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    console.log(`初步答案长度: ${initialAnswer.length} 字符`);

    // ===== 方案B：第二次Gemini调用 (图表需求分析和关键词生成) =====
    console.log("分析图表需求和生成关键词...");
    
    // 准备图表需求分析的提示词
    const diagramAnalysisPrompt = `
# ROLE
You are an expert BIAN banking architecture diagram analyst, specialized in determining when relevant BIAN diagrams would enhance an answer.

# TASK
Analyze the user's question and the initial answer to determine if diagrams would be helpful. If so, generate 3-5 precise search keywords to retrieve relevant BIAN diagrams.

# REQUIREMENTS
- First, analyze if any BIAN diagrams would genuinely enhance the answer
- Consider diagrams useful when explaining:
  * Service domain relationships
  * Business object models
  * Process flows
  * System architecture layers
  * Integration patterns
  * Control mechanisms
- If diagrams would help, generate 3-5 specific BIAN keywords or phrases for diagram retrieval
- Return ONLY the JSON object containing your analysis. DO NOT include markdown code fences (like \`\`\`json) or any text outside the JSON structure.

# INPUT
User Question: "${originalUserQuestion}"

Initial Answer Preview:
"""
${initialAnswer.substring(0, Math.min(2000, initialAnswer.length))}
${initialAnswer.length > 2000 ? '...' : ''}
"""

# OUTPUT
Return ONLY a valid JSON object with the following structure. NO MARKDOWN, NO EXTRA TEXT.
{
  "needDiagram": true/false,
  "keywords": "keyword1, keyword2, keyword3", (only if needDiagram is true)
  "reasoning": "Brief explanation of your decision"
}
`;

    // 调用Gemini分析图表需求
    const diagramAnalysisResult = await generativeModel.generateContent(diagramAnalysisPrompt);
    let diagramAnalysis: DiagramAnalysisResult = { needDiagram: false, keywords: "", reasoning: "" };
    
    try {
      if (diagramAnalysisResult && diagramAnalysisResult.response) {
        let analysisText = diagramAnalysisResult.response.text();
        
        // 清理可能存在的Markdown标记
        if (analysisText.startsWith("```json")) {
          analysisText = analysisText.substring(7);
        }
        if (analysisText.endsWith("```")) {
          analysisText = analysisText.substring(0, analysisText.length - 3);
        }
        analysisText = analysisText.trim(); // 移除可能的首尾空格
        
        diagramAnalysis = JSON.parse(analysisText) as DiagramAnalysisResult;
        console.log("图表分析结果:", diagramAnalysis);
      }
    } catch (analysisError) {
      console.error("Error parsing diagram analysis:", analysisError);
      // 输出原始文本以便调试
      if (diagramAnalysisResult?.response) {
        console.error("原始分析文本:", diagramAnalysisResult.response.text());
      }
      // 出错时默认不需要图表，继续流程
      console.log("默认不使用图表，继续生成最终答案");
    }

    // ===== 方案B：条件性图表检索 =====
    // 仅在需要图表时检索图表
    const emptyDiagramResponse: DiagramRetrievalResponse = { documents: [] };
    let diagramContext: DiagramRetrievalResponse = emptyDiagramResponse;
    
    if (diagramAnalysis.needDiagram && diagramAnalysis.keywords) {
      console.log(`需要图表，使用关键词检索: "${diagramAnalysis.keywords}"`);
      
      try {
        // 使用LLM生成的关键词检索图表
        diagramContext = await retrieveDiagrams(diagramAnalysis.keywords, 3);
        console.log(`检索到 ${diagramContext.documents.length} 个相关图表`);
        
        // 新增：验证检索到的图表数据
        diagramContext.documents.forEach((doc, idx) => {
          console.log(`检索到的图表 ${idx+1}: ${doc.source_display_name || doc.filename || 'unnamed'}`);
          if (!doc.svg_content) {
            console.error(`图表 ${idx+1} 缺少svg_content字段!`);
          } else if (doc.svg_content.length < 50) {
            console.error(`图表 ${idx+1} svg_content异常短: ${doc.svg_content.length}字符`);
            console.error(`SVG内容前50字符: ${doc.svg_content.substring(0, 50)}`);
          } else {
            console.log(`图表 ${idx+1} SVG内容长度: ${doc.svg_content.length}字符`);
          }
        });
      } catch (diagramError) {
        console.error("Error retrieving diagrams:", diagramError);
        // 错误处理但继续流程
      }
    } else {
      console.log("不需要图表，跳过图表检索步骤");
    }

    // ===== 方案B：添加图表信息到最终提示 =====
    // 如果有图表上下文，添加到提示中
    let diagramSections = "";
    
    if (diagramContext.documents && diagramContext.documents.length > 0) {
      console.log(`处理 ${diagramContext.documents.length} 个图表数据，准备添加到响应中`);
      
      // 验证图表SVG内容
      diagramContext.documents.forEach((doc, idx) => {
        if (!doc.svg_content || doc.svg_content.length < 50) {
          console.warn(`图表 ${idx+1} SVG内容异常，长度: ${doc.svg_content?.length || 0}`);
        } else if (!doc.svg_content.includes('<svg')) {
          console.warn(`图表 ${idx+1} 不包含有效的SVG标签`);
        } else {
          const svgLength = doc.svg_content.length;
          console.log(`图表 ${idx+1} SVG长度: ${svgLength} 字符, 标题: ${doc.source_display_name || doc.filename || "未命名"}`);
        }
      });

      diagramSections = diagramContext.documents.map((diagram, index) => {
        return `[DIAGRAM ${index + 1}]: ${diagram.text}\n<svg available: true, source: ${diagram.source_url || "unknown"}>`;
      }).join('\n\n');
      
      formattedDocuments += '\n\n--- Related BIAN Diagrams ---\n' + diagramSections;
    }

    // ===== 方案B：第三次Gemini调用 (最终答案重写与融合) =====
    console.log("生成最终答案...");
    
    // 如果有图表，准备最终答案重写的提示，包含图表融合
    let finalAnswerPrompt;
    
    if (diagramContext.documents && diagramContext.documents.length > 0) {
      finalAnswerPrompt = `
# ROLE
You are an expert BIAN (Banking Industry Architecture Network) specialist with deep knowledge of banking architectures and financial technology standards.

# TASK
Enhance the initial answer by integrating relevant BIAN diagrams to provide a more comprehensive and visual explanation.

# REQUIREMENTS
- Start with the initial answer and improve it by incorporating references to relevant diagrams
- When referencing diagrams, use the format: [See Diagram X: Title]
- Explain how each referenced diagram relates to the answer
- Position diagram references at appropriate points in the text
- Maintain the professional tone and accuracy of the original answer
- Keep all original citations and references intact
- Keep the same overall structure but enhance with diagram references
- Do not add any images or SVG code directly - only use references
- Diagrams should only be referenced where they genuinely enhance understanding

# INPUT
User's Original Question: "${originalUserQuestion}"

Initial Answer:
"""
${initialAnswer}
"""

Available BIAN Diagrams:
${diagramContext.documents.map((diagram, index) => 
  `Diagram ${index + 1}: ${diagram.source_display_name || diagram.filename || `BIAN Diagram ${index + 1}`}\n${diagram.text}`
).join('\n\n')}

# OUTPUT
Generate an enhanced version of the initial answer that integrates references to the relevant diagrams where appropriate.
`;
    } else {
      // 没有图表时使用初步答案
      finalAnswerPrompt = initialAnswerPrompt;
    }

    // 生成最终答案（如果有图表则融合图表，否则使用初步答案作为最终答案）
    const result = await generativeModel.generateContent(finalAnswerPrompt);
    console.log(`最终答案生成完成`);
    
    // 提取最终答案文本和Web Grounding信息
    let responseText = "";
    groundingData = null; // 重置为最终答案的groundingData

    if (result && result.response) {
      try {
        if (result.response.candidates && result.response.candidates.length > 0) {
          const candidate = result.response.candidates[0];
          
          // 提取响应文本 - 改进提取方法
          if (candidate?.content?.parts?.length > 0) {
            // 合并所有文本部分，确保不会漏掉任何内容
            responseText = candidate.content.parts
              .map(part => {
                // 使用类型断言处理未知类型
                try {
                  const anyPart = part as any;
                  if (typeof anyPart.text === 'string') {
                    return anyPart.text;
                  } else if (anyPart.text && typeof anyPart.text === 'object' && typeof anyPart.text.toString === 'function') {
                    return anyPart.text.toString();
                  }
                } catch (e) {
                  console.warn("Error accessing part.text:", e);
                }
                return '';
              })
              .filter(text => text)
              .join('\n');
          }
          
          // 数据验证：检查响应文本是否为空
          if (!responseText || responseText.trim() === '') {
            console.warn("Empty responseText extracted from Gemini API parts");
            
            // 尝试其他方法获取文本 - 使用类型断言
            try {
              const anyContent = candidate.content as any;
              if (anyContent && typeof anyContent.text === 'function') {
                try {
                  responseText = anyContent.text();
                  console.log("Extracted text using content.text() function, length:", responseText.length);
                } catch (textFuncError) {
                  console.error("Error using content.text() function:", textFuncError);
                }
              }
            } catch (e) {
              console.warn("Error accessing content.text:", e);
            }
            
            try {
              const anyCandidate = candidate as any;
              if (anyCandidate && typeof anyCandidate.text === 'function') {
                try {
                  responseText = anyCandidate.text();
                  console.log("Extracted text using candidate.text() function, length:", responseText.length);
                } catch (candidateTextError) {
                  console.error("Error using candidate.text() function:", candidateTextError);
                }
              }
            } catch (e) {
              console.warn("Error accessing candidate.text:", e);
            }
          } else {
            // 记录接收到的原始响应（截断显示）
            console.log(`Extracted response from parts, length: ${responseText.length}`);
            console.log("Raw response from Gemini (first 200 chars):", responseText.substring(0, 200));
          }
          
          // 提取Web Grounding元数据
          if (candidate?.groundingMetadata) {
            groundingData = {
              searchEntryPoint: candidate.groundingMetadata.searchEntryPoint,
              groundingChunks: candidate.groundingMetadata.groundingChunks,
              groundingSupports: candidate.groundingMetadata.groundingSupports,
              webSearchQueries: candidate.groundingMetadata.webSearchQueries,
            };
            console.log("Extracted grounding metadata:", JSON.stringify(groundingData, null, 2).substring(0, 200) + "...");
          } else {
            console.log("No grounding metadata available in the response.");
          }
          
        } else if (result.response.text && typeof result.response.text === "function") {
          // 直接从response获取文本
          try {
            console.log(`Attempting to extract text using response.text() from ${model}`);
            responseText = result.response.text();
            // 记录通过text()方法获取的响应（截断显示）
            console.log("Response via text() method (first 200 chars):", responseText.substring(0, 200));
          } catch (textFunctionError) {
            console.error("Error calling response.text() function:", textFunctionError);
            
            // 作为备用，尝试toString()
            if (result.response.toString) {
              try {
                responseText = result.response.toString();
                console.log("Extracted text using toString() method, length:", responseText.length);
              } catch (toStringError) {
                console.error("Error using toString() method:", toStringError);
              }
            }
          }
        } else if (typeof result.response === "string") {
          responseText = result.response;
          // 记录字符串形式的响应（截断显示）
          console.log("String response (first 200 chars):", responseText.substring(0, 200));
        } else {
          // 最后尝试使用JSON.stringify
          try {
            responseText = JSON.stringify(result.response);
            console.log("Extracted text by stringifying response object, length:", responseText.length);
          } catch (stringifyError) {
            console.error("Error stringifying response:", stringifyError);
            throw new Error("Cannot extract text from response in any way");
          }
        }
      } catch (extractionError: unknown) {
        console.error("Error extracting text from Gemini response:", extractionError);
        return new Response(
          JSON.stringify({
            error: `Failed to extract text from ${model} API response: ${extractionError instanceof Error ? extractionError.message : 'Unknown error'}`
          }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }
    } else {
      console.error("Invalid or missing response object from Gemini API:", result);
      return new Response(
        JSON.stringify({
          error: `Invalid response structure from ${model} API.`
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 如果最终答案提取失败，回退到初步答案
    if (!responseText || responseText.trim() === "") {
      console.warn("Failed to extract final answer, falling back to initial answer");
      responseText = initialAnswer;
    }

    // 保存原始响应文本，用于最后检查
    const originalResponseText = responseText;
    console.log("Original response length:", originalResponseText.length);

    // ===== 方案B：流式响应添加图表数据 =====
    // 创建包含图表数据的自定义流
    const streamData = new TextEncoder();
    const diagramData = diagramContext.documents.map((doc, index) => ({
      index: index + 1,
      title: doc.source_display_name || doc.filename || `BIAN Diagram ${index + 1}`,
      svg_content: doc.svg_content, // 注意：这里使用svg_content匹配前端DiagramDocument类型
      source_url: doc.source_url
    }));
    
    // 验证转换后的图表数据
    diagramData.forEach((diagram, idx) => {
      if (!diagram.svg_content || diagram.svg_content.length < 50) {
        console.warn(`转换后的图表 ${idx+1} SVG数据异常短或为空，长度: ${diagram.svg_content?.length || 0}`);
      } else if (typeof diagram.svg_content === 'string' && !diagram.svg_content.includes('<svg')) {
        console.warn(`转换后的图表 ${idx+1} 可能不包含有效的SVG标签`);
                } else {
        console.log(`转换后的图表 ${idx+1} SVG有效，长度: ${typeof diagram.svg_content === 'string' ? diagram.svg_content.length : 'undefined'}`);
      }
    });

    // 检查是否发生了内容丢失（通过比较原始响应和最终响应的长度）
    const originalLength = originalResponseText.length;
    const finalLength = responseText.length;
    
    console.log(`Response length check: Original=${originalLength}, Final=${finalLength}, Ratio=${finalLength/originalLength}`);
    
    // 移除末尾的图表引用内容
    const diagramsSectionPattern = /\n\n(?:---\n)?### BIAN Diagrams[\s\S]*$/;
    if (responseText.match(diagramsSectionPattern)) {
      responseText = responseText.replace(diagramsSectionPattern, '');
      console.log('移除了文本末尾的图表引用部分');
    }
    
    // 准备流式响应，包含文本和图表数据
    const readableStream = new ReadableStream({
      start(controller) {
        try {
          // 不要使用JSON.stringify，直接编码原始文本以保留Markdown格式
          const content = responseText;
          const textEncoder = new TextEncoder();
          
          // 构建AI SDK格式的文本数据块
          const textChunk = `0:"${content.replace(/"/g, '\\"')}"\n`;
          controller.enqueue(textEncoder.encode(textChunk));
          
          // 如果有图表数据，添加到流中
          if (diagramData.length > 0) {
            // 添加日志输出
            console.log(`正在将 ${diagramData.length} 个图表添加到流响应中`);
            
            // 验证每个图表的SVG内容
            diagramData.forEach((diagram, idx) => {
              console.log(`流响应中的图表 ${idx + 1}: 标题=${diagram.title}, SVG长度=${diagram.svg_content?.length || 'undefined'}`);
              if (!diagram.svg_content || !diagram.svg_content.includes('<svg')) {
                console.warn(`流响应中的图表 ${idx + 1} SVG内容无效或为空`);
              }
            });
            
            // 使用自定义分隔符标记图表数据开始
            const diagramStartMarker = `diagrams-start\n`;
            controller.enqueue(textEncoder.encode(diagramStartMarker));
            
            // 添加图表数据（JSON序列化）
            const diagramJsonChunk = JSON.stringify({diagrams: diagramData});
            console.log(`图表JSON数据长度: ${diagramJsonChunk.length} 字符`);
            controller.enqueue(textEncoder.encode(diagramJsonChunk));
            
            // 使用自定义分隔符标记图表数据结束
            const diagramEndMarker = `\ndiagrams-end\n`;
            controller.enqueue(textEncoder.encode(diagramEndMarker));
          }
          
          // 关闭流
          controller.close();
        } catch (streamError) {
          console.error("Error during stream creation:", streamError);
          controller.error(streamError);
        }
      }
    });

    // 返回包含图表数据的响应
    return new Response(readableStream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'X-Experimental-Stream-Data': 'true',
        'X-Has-Diagrams': diagramData.length > 0 ? 'true' : 'false',
        'X-Diagrams-Count': diagramData.length.toString()
      }
    });
  } catch (error: any) {
    console.error("Error in chat API route handler:", error);
    console.error("Error Cause:", error.cause);
    return new Response(
      JSON.stringify({
        error: error.message || "An unexpected error occurred"
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

const retrieveData = async (
  question: string, 
  messages: CoreMessage[]
): Promise<RetrievalContext> => {
  const token = process.env.VECTORIZE_TOKEN;
  const pipelineRetrievalUrl = process.env.VECTORIZE_RETRIEVAL_URL;

  if (!token || !pipelineRetrievalUrl) {
    throw new Error("缺少必要的环境变量: VECTORIZE_TOKEN 或 VECTORIZE_RETRIEVAL_URL");
  }

  const payload: any = {
    question,
    numResults: 5,
    rerank: true,
  };

  if (messages.length > 0) {
    payload.context = {
      messages: messages.map((message) => ({"role": message.role, "content": message.content})),
    };
  }

  const response = await fetch(pipelineRetrievalUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: token,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`获取数据失败: ${response.status} ${response.statusText}. ${errorText}`);
  }

  return await response.json() as RetrievalContext;
};

const retrieveDiagrams = async (
  keywords: string,
  numResults: number = 3
): Promise<DiagramRetrievalResponse> => {
  try {
    const diagramApiUrl = process.env.DIAGRAM_API_URL;

    if (!diagramApiUrl) {
      console.error("DIAGRAM_API_URL environment variable is not set!");
      throw new Error("Diagram retrieval service URL is not configured.");
    }
    
    console.log(`Retrieving diagrams from: ${diagramApiUrl}`);

    const response = await fetch(diagramApiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        question: keywords,
        numResults,
        rerank: true,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`图表检索失败: ${response.status} ${response.statusText}. ${errorText}`);
    }

    const data = await response.json();
    
    // 确保返回的数据符合DiagramRetrievalResponse接口
    const result: DiagramRetrievalResponse = {
      documents: Array.isArray(data.documents) 
        ? data.documents.map((doc: any, index: number) => {
            // 尝试从source_url提取更有意义的名称
            let betterName = "BIAN Diagram";
            
            if (doc.source_url) {
              // 从URL提取视图ID
              const viewMatch = doc.source_url.match(/view_(\d+)\.html/);
              if (viewMatch && viewMatch[1]) {
                betterName = `BIAN Service Domain Diagram (View ${viewMatch[1]})`;
              }
            }
            
            // 也可以尝试从SVG内容中提取文本节点分析标题
            
            return {
              text: doc.text || "",
              filename: doc.filename || "",
              source_display_name: betterName, // 使用改进的名称
              svg_content: doc.svg_content || "",
              source_url: doc.source_url || "",
              metadata: doc.metadata || {}
            };
          })
        : []
    };
    
    return result;
  } catch (error) {
    console.error("Error retrieving diagrams:", error);
    return { documents: [] }; // 返回空数组，确保流程继续
  }
};