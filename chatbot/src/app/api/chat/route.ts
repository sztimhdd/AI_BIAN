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
    // 更新为Gemini 2.5 Flash模型并启用Web Grounding
    const generativeModel = genAI.getGenerativeModel({ 
      model: "gemini-2.5-flash",  // 使用2.5 Flash模型，更快且支持网络搜索
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
          console.log(`Rewritten query: "${rewrittenQuery}"`);
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
    console.log("Starting request to Gemini 2.5 with Web Grounding...");

    let formattedDocuments = "";
    let documentSources: {title: string, link: string}[] = [];
    
    if (context && context.documents) {
      // 保存文档源信息以便后续添加引用
      documentSources = context.documents.map((doc, index) => {
        return {
          title: doc.source_display_name || doc.filename,
          link: `https://example.com/${encodeURIComponent(doc.source_display_name || doc.filename)}`
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
你是一位精通BIAN(银行业架构网络)的专家助手，擅长解释银行架构和金融技术标准。

# TASK
为用户提供关于BIAN的全面、准确和专业的回答，涵盖BIAN框架、服务领域、实施方法等方面。

# REQUIREMENTS
- 综合使用以下信息来源:
  1. 你的内部BIAN知识库
  2. 提供的文档摘录
  3. 通过Google搜索获取的最新信息
- 优先考虑准确性和专业性
- 适当引用相关信息来源以增强回答可信度
- 使用清晰、专业的语言
- 回答中使用简体中文
- 如果不确定或需要更多信息，请使用网络搜索查找答案
- 结构化你的回答，使用标题、列表或表格提高可读性

# INPUT
用户原始问题: "${originalUserQuestion}"

提供的文档摘录:
<chunks>
${formattedDocuments}
</chunks>

# OUTPUT
生成一个全面、权威的BIAN相关回答，适当引用可靠来源。需要时可使用网络搜索获取最新信息。
`;

    // Generate the final answer
    console.log("Sending prompt to Gemini API with Web Grounding enabled...");
    const result = await generativeModel.generateContent(finalAnswerPrompt);
    console.log("Received response from Gemini API");
    
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
        console.log("Attempting to extract text using response.text()");
        responseText = result.response.text();
      } else if (typeof result.response === "string") {
        responseText = result.response;
      } else {
        console.error("Unexpected response format, cannot extract text:", result.response);
        return new Response(
          JSON.stringify({
            error: "Invalid response format from Gemini API."
          }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }
    } else {
      console.error("Invalid or missing response object from Gemini API:", result);
      return new Response(
        JSON.stringify({
          error: "Invalid response structure from Gemini API."
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 处理引用信息，添加到响应文本
    if (documentSources.length > 0 || (groundingData && groundingData.groundingChunks && groundingData.groundingChunks.length > 0)) {
      
      // 添加引用信息到响应
      responseText += "\n\n---\n### 参考资料\n";
      
      // 首先添加RAG文档引用
      if (documentSources.length > 0) {
        documentSources.forEach((source, index) => {
          responseText += `[BIAN ${index + 1}] [${source.title}](${source.link})\n`;
        });
      }
      
      // 再添加Web Search引用
      if (groundingData && groundingData.groundingChunks) {
        groundingData.groundingChunks.forEach((chunk, index) => {
          if (chunk.web && chunk.web.uri) {
            const title = chunk.web.title || "参考链接";
            responseText += `[Web ${index + 1}] [${title}](${chunk.web.uri})\n`;
          }
        });
      }
      
      // 添加搜索建议
      if (groundingData && groundingData.webSearchQueries && groundingData.webSearchQueries.length > 0) {
        responseText += "\n### 延伸搜索\n";
        groundingData.webSearchQueries.forEach(query => {
          responseText += `- ${query}\n`;
        });
      }
      
      // 添加归因信息
      if ((groundingData && groundingData.groundingChunks && groundingData.groundingChunks.length > 0) || documentSources.length > 0) {
        responseText += "\n<small>*部分信息来自BIAN知识库和Web搜索结果</small>";
      }
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

    // Streaming Response: Create a stream from the responseText
    const readableStream = new ReadableStream({
      start(controller) {
        // 包含完整的响应文本
        const formattedChunk = `0:"${JSON.stringify(responseText).slice(1, -1)}"\n`; // Format as 0:"<escaped-text>"\n
        controller.enqueue(new TextEncoder().encode(formattedChunk));
        
        // 如果有搜索元数据，可以添加到流中作为单独的消息
        if (groundingData && groundingData.searchEntryPoint && groundingData.searchEntryPoint.renderedContent) {
          // 这里只记录，不添加到流中，前端处理稍后实现
          console.log("Search entry point data is available for frontend rendering");
        }
        
        controller.close();
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