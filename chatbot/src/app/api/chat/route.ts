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

// 使用API提供的类型定义简化自定义接口
interface GroundingMetadata {
  searchEntryPoint?: SearchEntryPoint;
  groundingChunks?: ApiGroundingChunk[];
  groundingSupports?: ApiGroundingSupport[];
  webSearchQueries?: string[];
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

    // Final Answer Generation: Generate comprehensive answer
    // 添加日志记录，用于调试
    console.log(`Starting request to ${model} with Web Grounding...`);

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

    // Prepare the final answer generation prompt
    const finalAnswerPrompt = `
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

    // Generate the final answer
    console.log(`Sending prompt to ${model} API with Web Grounding enabled...`);
    const result = await generativeModel.generateContent(finalAnswerPrompt);
    console.log(`Received response from ${model} API`);
    
    // 提取响应文本和Web Grounding信息
    let responseText = "";
    let groundingData: GroundingMetadata | null = null;

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

    // 确保我们有有效的响应文本
    if (!responseText || responseText.trim() === "") {
      console.error("All extraction methods failed, no valid text extracted from API response");
      return new Response(
        JSON.stringify({
          error: "Failed to extract any valid content from model response."
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 保存原始响应文本，用于最后检查
    const originalResponseText = responseText;
    console.log("Original response length:", originalResponseText.length);

    // 处理引用信息，添加到响应文本 - 修改为英文输出
    if (documentSources.length > 0 || (groundingData && groundingData.groundingChunks && groundingData.groundingChunks.length > 0)) {
      // 添加分隔符和引用标题前，确保有足够的空行
      if (!responseText.endsWith("\n\n")) {
        // 如果文本不以两个换行符结束，添加额外的换行符
        responseText += responseText.endsWith("\n") ? "\n" : "\n\n";
      }
      
      // 添加引用信息到响应 - 使用英文
      responseText += "---\n### References\n";
      
      // 首先添加RAG文档引用 - 使用英文并改进去重逻辑
      if (documentSources.length > 0) {
        responseText += "\n#### BIAN Knowledge Base Documents\n";
        
        // 创建一个Map来跟踪已添加的文档，使用标准化的URL作为键
        const addedDocuments = new Map();
        
        // 处理文档源并去重
        documentSources.forEach((source, index) => {
          // 提取文档真实名称
          let cleanTitle = source.title || `BIAN Document ${index + 1}`;
          
          // 标准化链接URL以便更好地去重
          let normalizedLink = source.link.replace(/^https?:\/\/(www\.)?/, '').toLowerCase();
          
          // 如果这个URL已经添加过，跳过
          if (addedDocuments.has(normalizedLink)) {
            return;
          }
          
          // 特殊处理BIAN特定链接格式
          if (normalizedLink.includes('bian.org')) {
            // 对于BIAN官方文档，进行更精确的链接处理
            
            // 提取BIAN文档类型和识别符，以生成最合适的链接格式
            const isBianDocument = (
              cleanTitle.toLowerCase().includes('bian') || 
              normalizedLink.includes('bian.org')
            );
            
            if (isBianDocument) {
              // 识别BIAN文档的不同类型
              const isServiceDomain = (
                cleanTitle.includes('Service Domain') || 
                cleanTitle.includes('SD ') ||
                cleanTitle.match(/\bSD\b/)
              );
              
              const isGuide = (
                cleanTitle.includes('Guide') || 
                cleanTitle.includes('Handbook') || 
                cleanTitle.includes('Guidelines')
              );
              
              const isAPISpec = (
                cleanTitle.includes('API') || 
                cleanTitle.includes('Specification') ||
                cleanTitle.includes('Semantic API')
              );
              
              // 提取数字ID（如果存在）
              const numericIdMatch = cleanTitle.match(/\d{7,}/);
              const hasNumericId = numericIdMatch !== null;
              
              // 根据文档类型生成最合适的链接
              if (hasNumericId) {
                // 如果有数字ID，优先使用它构建语义API文档链接
                const numericId = numericIdMatch![0];
                normalizedLink = `bian.org/semantic-apis/document/${numericId}`;
                source.link = `https://${normalizedLink}`;
              } 
              else if (isServiceDomain) {
                // 处理服务域文档
                const sdName = cleanTitle
                  .replace(/Service Domain/i, '')
                  .replace(/\bSD\b/i, '')
                  .trim()
                  .replace(/\s+/g, '-')
                  .toLowerCase();
                
                normalizedLink = `bian.org/servicelandscape/service-domains/${sdName}`;
                source.link = `https://${normalizedLink}`;
              }
              else if (isAPISpec) {
                // 处理API规范文档
                const apiName = cleanTitle
                  .replace(/API|Specification|Semantic/ig, '')
                  .trim()
                  .replace(/\s+/g, '-')
                  .toLowerCase();
                
                normalizedLink = `bian.org/semantic-apis/apis/${apiName}`;
                source.link = `https://${normalizedLink}`;
              }
              else if (isGuide) {
                // 处理指南类文档
                const guideName = cleanTitle
                  .replace(/Guide|Handbook|Guidelines/ig, '')
                  .trim()
                  .replace(/\s+/g, '-')
                  .toLowerCase();
                
                normalizedLink = `bian.org/servicelandscape/guidelines/${guideName}`;
                source.link = `https://${normalizedLink}`;
              }
              else {
                // 处理其他BIAN文档
                const docId = cleanTitle
                  .replace(/BIAN/i, '')
                  .trim()
                  .replace(/\s+/g, '-')
                  .toLowerCase();
                
                normalizedLink = `bian.org/deliverables/${docId}`;
                source.link = `https://${normalizedLink}`;
              }
            }
          }
          
          // 记录这个文档已经被添加，并存储引用编号
          const referenceNumber = addedDocuments.size + 1;
          addedDocuments.set(normalizedLink, referenceNumber);
          
          // 添加到引用列表 - 移除链接，只显示序号和标题
          responseText += `[${referenceNumber}] ${cleanTitle}\n`;
        });
      }
      
      // 获取已添加的文档引用数量
      let referenceCounter = documentSources.length > 0 ? 
                            new Map(documentSources.map(s => 
                              [s.link.replace(/^https?:\/\/(www\.)?/, '').toLowerCase(), true]
                            )).size : 0;
      
      // 改进Web Search引用处理
      if (groundingData && groundingData.groundingChunks && groundingData.groundingChunks.length > 0) {
        // 提取web引用并改进URL处理
        let webReferences = groundingData.groundingChunks
          .filter(chunk => chunk.web && chunk.web.uri)
          .map(chunk => {
            // 修复和标准化grounding链接
            let uri = chunk.web?.uri || "";
            let title = chunk.web?.title || "Web Reference";
            
            // 处理Google Vertex AI Search的代理链接
            if (uri.includes('vertexaisearch.cloud.google.com/grounding-api-redirect')) {
              // 更精确地提取目标URL
              try {
                // 尝试构建URL对象并提取url参数
                const urlObj = new URL(uri);
                const urlParam = urlObj.searchParams.get('url');
                
                if (urlParam) {
                  // 如果有URL参数，直接使用
                  uri = urlParam;
                  
                  // 进一步尝试解码嵌套URL（有时URL会被多重编码）
                  try {
                    const decodedUrl = decodeURIComponent(uri);
                    if (decodedUrl !== uri && decodedUrl.startsWith('http')) {
                      uri = decodedUrl;
                    }
                  } catch (decodeError) {
                    // 解码失败，保持原样
                    console.warn("Failed to decode nested URL:", decodeError);
                  }
                } else {
                  // 否则尝试从路径中提取域名
                  const domainMatch = uri.match(/\/(www\.[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+)/);
                  if (domainMatch && domainMatch[1]) {
                    uri = `https://${domainMatch[1]}`;
                  } else {
                    // 尝试另一种格式提取域名
                    const altDomainMatch = uri.match(/\/([a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+)/);
                    if (altDomainMatch && altDomainMatch[1]) {
                      uri = `https://${altDomainMatch[1]}`;
                    }
                  }
                }
              } catch (urlError) {
                // URL解析失败，回退到正则表达式方法
                console.warn("Failed to parse redirect URL:", urlError);
                
                // 尝试从路径中提取域名
                const domainMatch = uri.match(/\/(www\.[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+)/);
                if (domainMatch && domainMatch[1]) {
                  uri = `https://${domainMatch[1]}`;
                } else {
                  // 尝试另一种格式提取域名
                  const altDomainMatch = uri.match(/\/([a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+)/);
                  if (altDomainMatch && altDomainMatch[1]) {
                    uri = `https://${altDomainMatch[1]}`;
                  }
                }
              }
            }
            
            // 清理和规范化标题
            if (title) {
              // 移除过长标题中的噪音内容
              if (title.length > 70) {
                title = title.substring(0, 67) + '...';
              }
              
              // 移除标题中可能的HTML元素
              title = title.replace(/<[^>]*>/g, '');
            }
            
            return {
              title: title,
              uri: uri,
            };
          });
          
        // 使用Map进行更高效的去重，以URL为键
        const uniqueUrls = new Map();
        webReferences.forEach(ref => {
          // 标准化URL
          const normalizedUrl = ref.uri.replace(/^https?:\/\/(www\.)?/, '').toLowerCase();
          
          // 只保留每个URL的第一个引用
          if (!uniqueUrls.has(normalizedUrl)) {
            uniqueUrls.set(normalizedUrl, ref);
          }
        });
        
        // 从Map转换回数组
        webReferences = Array.from(uniqueUrls.values());
        
        if (webReferences.length > 0) {
          responseText += "\n#### Web Resources\n";
          webReferences.forEach((ref) => {
            referenceCounter++;
            // 移除Web资源链接，只显示序号和标题
            responseText += `[${referenceCounter}] ${ref.title}\n`;
          });
        }
      }
      
      // 改进搜索建议的处理和显示
      if (groundingData && groundingData.webSearchQueries && groundingData.webSearchQueries.length > 0) {
        // 过滤和去重搜索建议
        const uniqueQueries = [...new Set(groundingData.webSearchQueries
          .filter(query => query && query.trim().length > 0)
          .map(query => query.trim())
        )]; 
        
        if (uniqueQueries.length > 0) {
          responseText += "\n### Related Search Topics\n";
          uniqueQueries.forEach(query => {
            // 确保查询内容是有意义的
            if (query.length > 3 && !query.includes("undefined")) {
              responseText += `- ${query}\n`;
            }
          });
        }
      }
      
      // 改进归因信息的显示格式
      responseText += "\n\n*Information sourced from BIAN Architecture documents and web resources*";
    }

    // 检查是否发生了内容丢失（通过比较原始响应和最终响应的长度）
    const originalLength = originalResponseText.length;
    const finalLength = responseText.length;
    
    console.log(`Response length check: Original=${originalLength}, Final=${finalLength}, Ratio=${finalLength/originalLength}`);
    
    if (originalLength > 100 && finalLength > originalLength * 1.1) {
      console.log("Response appears to have references successfully appended");
    } else if (originalLength > 100 && finalLength < originalLength * 1.1) {
      console.warn("Possible content loss detected - final response not significantly longer than original");
    }

    // Add logging for debugging
    console.log("Final response text length:", responseText.length);
    console.log("Response text first 100 chars:", responseText.substring(0, 100));
    console.log("Response text last 100 chars:", responseText.substring(responseText.length - 100));

    // 优化流式响应处理
    if (!responseText || responseText.trim() === "") {
      console.error("Empty response text detected, returning error");
      return new Response(
        JSON.stringify({
          error: "Generated empty response from the model. Please try again."
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Streaming Response: Create a stream from the responseText
    const readableStream = new ReadableStream({
      start(controller) {
        try {
          // 为流式传输准备响应文本
          // 使用安全的序列化方法，保持格式和换行符
          
          // 使用JSON.stringify来处理特殊字符
          const serialized = JSON.stringify(responseText);
          
          // 移除JSON序列化添加的首尾双引号
          const content = serialized.slice(1, -1);
          
          // 构建AI SDK格式的数据块
          const formattedChunk = `0:"${content}"\n`;
          
          // 记录发送的数据大小
          console.log(`Sending response chunk of size: ${formattedChunk.length} bytes`);
          
          // 发送数据
          controller.enqueue(new TextEncoder().encode(formattedChunk));
          
          // 记录但不添加搜索元数据
          if (groundingData && groundingData.searchEntryPoint && groundingData.searchEntryPoint.renderedContent) {
            console.log("Search entry point data is available for frontend rendering");
          }
          
          // 关闭流
          controller.close();
        } catch (streamError) {
          console.error("Error during stream creation:", streamError);
          controller.error(streamError);
        }
      }
    });

    // Add log after successful stream creation
    console.log("ReadableStream created successfully with AI SDK data format.");

    // Return the stream using the standard Web API Response
    return new Response(readableStream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'X-Experimental-Stream-Data': 'true' // Indicate AI SDK Stream Data format
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
  messages: CoreMessage[], 
): Promise<RetrievalContext> => {
  const token = process.env.VECTORIZE_TOKEN;
  const pipelineRetrievalUrl = process.env.VECTORIZE_RETRIEVAL_URL;

  if (!token) {
    throw new Error(
      "VECTORIZE_TOKEN is not set in the environment variables. Please add it to your environment settings (e.g. .env.develoment) file."
    );
  }

  if (!pipelineRetrievalUrl) {
    throw new Error(
      "VECTORIZE_RETRIEVAL_URL is not set. Please define the URL in the environment settings (e.g. in the file .env.development) before calling retrieveData."
    );
  }

  const payload: any = {
    question,
    numResults: 5,
    rerank: true,
  };

  if (messages && messages.length > 0) {
    payload.context = {
      messages: messages.map((message) => ({"role": message.role, "content": message.content})),
    };
  }

  try {
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
      throw new Error(`Failed to fetch data: ${response.status} ${response.statusText}. ${errorText}`);
    }

    const data = await response.json();
    return data as RetrievalContext;
  } catch (error: any) {
    console.error("Error retrieving data:", error);
    throw new Error(`Failed to retrieve data: ${error.message}`);
  }
};