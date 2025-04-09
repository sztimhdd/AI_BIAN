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
        // 简化文档链接提取逻辑
        let docLink;
        
        // 检查文档对象中是否有直接的URL字段
        if (doc.source_url || doc.url || doc.link || doc.document_url) {
          docLink = doc.source_url || doc.url || doc.link || doc.document_url;
        } 
        // 检查元数据中是否有URL相关字段
        else if (doc.metadata && (doc.metadata.url || doc.metadata.source_url || doc.metadata.link)) {
          docLink = doc.metadata.url || doc.metadata.source_url || doc.metadata.link;
        } 
        // 使用更规范的默认链接格式
        else {
          // 使用文档标识符构建一致的链接格式
          const docIdentifier = doc.source_display_name || doc.filename || `document-${index+1}`;
          docLink = `https://bian.org/servicelandscape/reference/${encodeURIComponent(docIdentifier)}`;
        }
        
        // 简化文档标题提取逻辑
        const docTitle = doc.source_display_name || doc.filename || `BIAN Document ${index + 1}`;
        
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
      if (result.response.candidates && result.response.candidates.length > 0) {
        const candidate = result.response.candidates[0];
        
        // 提取响应文本
        responseText = candidate?.content?.parts[0]?.text ?? '';
        if (!responseText) {
          console.warn("Extracted empty responseText from Gemini result candidates.");
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
        
      } else if (typeof result.response.text === "function") {
        console.log(`Attempting to extract text using response.text() from ${model}`);
        responseText = result.response.text();
      } else if (typeof result.response === "string") {
        responseText = result.response;
      } else {
        console.error("Unexpected response format, cannot extract text:", result.response);
        return new Response(
          JSON.stringify({
            error: `Invalid response format from ${model} API.`
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

    // 处理引用信息，添加到响应文本 - 修改为英文输出
    if (documentSources.length > 0 || (groundingData && groundingData.groundingChunks && groundingData.groundingChunks.length > 0)) {
      
      // 添加引用信息到响应 - 使用英文
      responseText += "\n\n---\n### References\n";
      
      // 首先添加RAG文档引用 - 使用英文
      if (documentSources.length > 0) {
        responseText += "\n#### BIAN Knowledge Base Documents\n";
        documentSources.forEach((source, index) => {
          // 提取文档真实名称，移除可能的路径或扩展名
          const cleanTitle = source.title
            .replace(/\.[^/.]+$/, "") // 移除文件扩展名
            .split('/').pop() || // 从路径中提取文件名
            `BIAN Document ${index + 1}`;
            
          responseText += `[${index + 1}] [${cleanTitle}](${source.link})\n`;
        });
      }
      
      // 再添加Web Search引用 - 使用英文
      if (groundingData && groundingData.groundingChunks && groundingData.groundingChunks.length > 0) {
        let webReferences = groundingData.groundingChunks
          .filter(chunk => chunk.web && chunk.web.uri)
          .map((chunk, index) => ({
            title: chunk.web?.title || "Web Reference",
            uri: chunk.web?.uri || "",
          }));
          
        // 去重，避免重复的引用
        const uniqueUrls = new Set();
        webReferences = webReferences.filter(ref => {
          if (!uniqueUrls.has(ref.uri)) {
            uniqueUrls.add(ref.uri);
            return true;
          }
          return false;
        });
        
        if (webReferences.length > 0) {
          responseText += "\n#### Web Resources\n";
          webReferences.forEach((ref, index) => {
            responseText += `[${index + 1}] [${ref.title}](${ref.uri})\n`;
          });
        }
      }
      
      // 添加搜索建议 - 使用英文
      if (groundingData && groundingData.webSearchQueries && groundingData.webSearchQueries.length > 0) {
        responseText += "\n### Related Search Topics\n";
        const uniqueQueries = [...new Set(groundingData.webSearchQueries)]; // 去重
        uniqueQueries.forEach(query => {
          responseText += `- ${query}\n`;
        });
      }
      
      // 添加归因信息 - 使用英文
      responseText += "\n<small>*Information sourced from BIAN Architecture documents and web resources*</small>";
    }

    // 添加分析数据，仅在响应文本中包含引用标记的情况下
    if (groundingData && groundingData.groundingSupports && groundingData.groundingSupports.length > 0) {
      console.log("Grounding supports available:", groundingData.groundingSupports.length);
      
      // 这部分只是记录在日志中，不添加到响应 - 使用安全的方式访问数据
      try {
        // 仅记录支持数据的存在，避免深入访问可能不存在的属性
        console.log(`First support data sample: ${JSON.stringify(groundingData.groundingSupports[0]).substring(0, 100)}...`);
      } catch (e) {
        console.error("Error logging grounding support data:", e);
      }
    }

    // Add log before creating stream
    console.log("Response text extracted:", responseText ? responseText.substring(0, 100) + "..." : "EMPTY");

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
          // 第一步：确保响应文本正确格式化和转义
          // - 去除可能导致JSON解析错误的特殊字符
          // - 替换双引号前的反斜杠，避免双重转义
          const formattedText = responseText
            .replace(/\\/g, '\\\\')  // 先转义所有反斜杠
            .replace(/"/g, '\\"');   // 再转义所有双引号
          
          // 包含完整的响应文本
          const formattedChunk = `0:"${formattedText}"\n`; // Format as 0:"<escaped-text>"\n
          controller.enqueue(new TextEncoder().encode(formattedChunk));
          
          // 如果有搜索元数据，可以添加到流中作为单独的消息
          if (groundingData && groundingData.searchEntryPoint && groundingData.searchEntryPoint.renderedContent) {
            // 这里只记录，不添加到流中，前端处理稍后实现
            console.log("Search entry point data is available for frontend rendering");
          }
          
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