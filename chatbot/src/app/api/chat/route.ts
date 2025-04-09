import { CoreMessage } from "ai";
// import { StreamingTextResponse } from "@ai-sdk/core";
// import { openai } from "@ai-sdk/openai"; // 移除 OpenAI 导入
// import { groq } from "@ai-sdk/groq"; // 移除 Groq 导入
import { GoogleGenerativeAI } from "@google/generative-ai"; // 导入 Google Generative AI 库

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
    const generativeModel = genAI.getGenerativeModel({ model: "gemini-2.0-flash" }); // Use Gemini model

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
    let formattedDocuments = "";
    
    if (context && context.documents) {
      // Format documents for the prompt
      formattedDocuments = context.documents.map((doc, index) => {
        const sourceId = `source=${index + 1}&link=https://example.com/${encodeURIComponent(doc.source_display_name || doc.filename)}`;
        return `[${sourceId}]\n${doc.text}`;
      }).join('\n\n');
    }

    // Prepare the final answer generation prompt
    const finalAnswerPrompt = `
# ROLE
You are an enterprise BIAN expert specializing in BIAN and enterprise architecture.

# TASK
Provide a comprehensive and accurate answer in English to the user's question.

# REQUIREMENTS
- Synthesize information from:
  1. Your internal knowledge base regarding BIAN
  2. The provided document excerpts
  3. Your general world knowledge for context
- Prioritize accuracy and depth
- Cite specific, relevant details from the excerpts when appropriate
- Respond in clear, professional English
- Structure the answer logically

# INPUT
User's Original Question: "${originalUserQuestion}"

Provided Document Excerpts:
<chunks>
${formattedDocuments}
</chunks>

# OUTPUT
Generate only the final answer in English to the user's question.
`;

    // Generate the final answer
    const result = await generativeModel.generateContent(finalAnswerPrompt);
    
    // Extract response text
    let responseText = "";
    if (result && result.response) {
      if (result.response.candidates && result.response.candidates.length > 0) {
        responseText = result.response.candidates[0]?.content?.parts[0]?.text ?? '';
        if (!responseText) {
          console.warn("Extracted empty responseText from Gemini result candidates.");
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

    // Add log before creating stream
    console.log("Response text extracted:", responseText ? responseText.substring(0, 100) + "..." : "EMPTY");

    // Streaming Response: Create a stream from the responseText
    const readableStream = new ReadableStream({
      start(controller) {
        const formattedChunk = `0:"${JSON.stringify(responseText).slice(1, -1)}"\n`; // Format as 0:"<escaped-text>"\n
        controller.enqueue(new TextEncoder().encode(formattedChunk));
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