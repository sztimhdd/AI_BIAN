import { CoreMessage } from "ai";
import { GoogleGenerativeAI } from "@google/generative-ai";

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

export async function POST(req: Request) {
  try {
    const { messages }: { messages: CoreMessage[] } = await req.json();
    const model = process.env.MODEL || "gemini-2.0-flash"; // 默认模型
    
    // 验证必要的环境变量
    const apiKey = process.env.GEMINI_API_KEY;
    
    if (!apiKey) {
      return Response.json(
        { error: "GEMINI_API_KEY 未在环境变量中设置" },
        { status: 500 }
      );
    }

    // 获取用户的最后一条消息
    if (messages.length === 0) {
      return Response.json(
        { error: "未提供消息" },
        { status: 400 }
      );
    }
    
    const userMessage = messages[messages.length - 1];
    const previousMessages = messages.slice(0, -1);
    let enhancedMessages = [...messages]; // 创建消息的副本，以便可以修改
    
    // 获取上下文信息（如果有）
    try {
      const context = await retrieveData(
        String(userMessage.content), 
        previousMessages
      );
      
      // 如果有上下文数据，创建增强的提示
      if (context?.documents?.length) {
        enhancedMessages = enhanceMessagesWithContext(messages, context);
      }
    } catch (error: any) {
      console.error("检索上下文时出错:", error);
      // 继续处理，即使没有上下文
    }

    console.log(`发送消息到 GEMINI 模型 (${model})`);
    
    // 直接使用备用方法（已经确认可以工作）
    return handleGeminiGeneration(enhancedMessages, model, apiKey);
    
  } catch (error: any) {
    console.error("聊天API错误:", error);
    return Response.json(
      { error: error.message || "发生了意外错误" },
      { status: 500 }
    );
  }
}

// Gemini生成处理函数
async function handleGeminiGeneration(messages: CoreMessage[], model: string, apiKey: string) {
  try {
    console.log("使用Gemini生成响应...");
    
    // 初始化Google客户端
    const genAI = new GoogleGenerativeAI(apiKey);
    const generativeModel = genAI.getGenerativeModel({ model });
    
    // 转换消息格式为Google格式
    const googleMessages: Array<{role: string, parts: Array<{text: string}>}> = [];
    
    // 首先添加用户历史消息
    for (const message of messages) {
      if (message.role === 'user' || message.role === 'assistant') {
        googleMessages.push({
          role: message.role === 'user' ? 'user' : 'model',
          parts: [{ text: String(message.content) }]
        });
      }
    }
    
    console.log("准备发送到Google API的消息:", { messagesCount: googleMessages.length });
    
    // 调用Gemini API
    const result = await generativeModel.generateContentStream({
      contents: googleMessages.length > 0 ? googleMessages : [{ 
        role: 'user' as const, 
        parts: [{ text: String(messages[messages.length - 1].content) }] 
      }],
      generationConfig: {
        temperature: 0.7,
        topP: 0.95,
        topK: 40,
        maxOutputTokens: 4000,
      },
    });
    
    console.log("Google API流创建成功");
    
    // 创建符合OpenAI格式的标准SSE流
    const encoder = new TextEncoder();
    return new Response(
      new ReadableStream({
        async start(controller) {
          try {
            console.log("开始流处理...");
            
            // 生成唯一ID和时间戳
            const messageId = crypto.randomUUID();
            const timestamp = Math.floor(Date.now() / 1000);  // OpenAI使用的是秒级时间戳
            
            // 1. 发送初始消息 - 必须严格符合OpenAI格式
            const initialMessage = {
              id: `chatcmpl-${messageId}`,
              object: "chat.completion.chunk",
              created: timestamp,
              model: model,
              choices: [
                {
                  index: 0,
                  delta: { role: "assistant" },
                  finish_reason: null
                }
              ]
            };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(initialMessage)}\n\n`));
            
            // 处理流
            let accumulatedText = "";
            try {
              for await (const chunk of result.stream) {
                const text = chunk.text();
                if (text) {
                  accumulatedText += text;
                  
                  // 2. 发送内容增量 - 严格符合OpenAI格式
                  const contentChunk = {
                    id: `chatcmpl-${messageId}`,
                    object: "chat.completion.chunk",
                    created: timestamp,
                    model: model,
                    choices: [
                      {
                        index: 0,
                        delta: { content: text },
                        finish_reason: null
                      }
                    ]
                  };
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify(contentChunk)}\n\n`));
                }
              }
              
              // 3. 发送完成标记 - 严格符合OpenAI格式
              const completionMessage = {
                id: `chatcmpl-${messageId}`,
                object: "chat.completion.chunk",
                created: timestamp,
                model: model,
                choices: [
                  {
                    index: 0,
                    delta: {},
                    finish_reason: "stop"
                  }
                ]
              };
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(completionMessage)}\n\n`));
              
              // 4. 发送[DONE]标记
              controller.enqueue(encoder.encode('data: [DONE]\n\n'));
              
              console.log("流处理完成，总长度:", accumulatedText.length);
            } catch (streamError) {
              console.error("流处理遇到错误:", streamError);
              
              // 发送错误消息
              const errorMessage = {
                id: `chatcmpl-${messageId}`,
                object: "chat.completion.chunk",
                created: timestamp,
                model: model,
                choices: [
                  {
                    index: 0,
                    delta: { content: "\n\n生成遇到错误，请重试。" },
                    finish_reason: "error"
                  }
                ]
              };
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(errorMessage)}\n\n`));
              controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            }
            
            // 关闭控制器
            controller.close();
          } catch (error) {
            console.error("响应流初始化错误:", error);
            controller.error(error);
          }
        }
      }),
      {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform',
          'Connection': 'keep-alive',
        }
      }
    );
  } catch (error) {
    console.error("Gemini生成错误:", error);
    return Response.json({ 
      error: "生成失败", 
      details: error instanceof Error ? error.message : String(error) 
    }, { status: 500 });
  }
}

// 增强消息，添加上下文信息
function enhanceMessagesWithContext(messages: CoreMessage[], context: RetrievalContext): CoreMessage[] {
  const enhancedMessages = [...messages];
  const documents = context.documents || [];
  
  // 格式化文档
  const formattedDocuments = documents.map((doc, index) => {
    const sourceId = `source=${index + 1}&link=https://example.com/${encodeURIComponent(doc.source_display_name || doc.filename)}`;
    return `[${sourceId}]\n${doc.text}`;
  }).join('\n\n');

  // 只修改最后一条消息的内容
  if (enhancedMessages.length > 0) {
    const lastIndex = enhancedMessages.length - 1;
    const lastMessage = enhancedMessages[lastIndex];
    const role = lastMessage.role;
    
    // 使用原始角色和新内容创建新的消息
    // 避免使用展开运算符以防止类型问题
    const newContent = `
You are tasked with answering a question using provided chunks of information. Your goal is to provide an accurate answer while citing your sources using a specific markdown format.

Here is the question you need to answer:
<question>
${String(lastMessage.content)}
</question>

Below are chunks of information that you can use to answer the question. Each chunk is preceded by a 
source identifier in the format [source=X&link=Y], where X is the source number and Y is the URL of the source:

<chunks>
${formattedDocuments}
</chunks>

Your task is to answer the question using the information provided in these chunks. 
When you use information from a specific chunk in your answer, you must cite it using a markdown link format. 
The citation should appear at the end of the sentence where the information is used.

If you cannot answer the question using the provided chunks, say "Sorry I don't know".

The citation format should be as follows:
[Chunk source](URL)

For example, if you're using information from the chunk labeled [source=3&link=https://example.com/page], your citation would look like this:
[3](https://example.com/page) and would open a new tab to the source URL when clicked.
`;
    
    // 根据角色创建正确的消息类型
    if (role === 'user') {
      enhancedMessages[lastIndex] = { role: 'user', content: newContent };
    } else if (role === 'assistant') {
      enhancedMessages[lastIndex] = { role: 'assistant', content: newContent };
    } else if (role === 'system') {
      enhancedMessages[lastIndex] = { role: 'system', content: newContent };
    } else if (role === 'tool') {
      // 对于tool类型，我们需要保持原始结构
      // 由于TypeScript类型限制，这里可能无法完全支持tool类型消息的增强
      console.warn("无法为'tool'类型消息增强上下文");
    }
  }
  
  return enhancedMessages;
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