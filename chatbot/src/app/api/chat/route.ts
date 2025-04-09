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

    let context: RetrievalContext | null = null;

    if (messages.length > 0) {
      try {
        const previousMessages = messages.slice(0, -1);
        context = await retrieveData(String(messages[messages.length - 1].content), previousMessages);
      } catch (retrieveError: any) {
        return new Response(
          JSON.stringify({
            error: retrieveError.message || "Failed to retrieve context data"
          }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }
    } else {
      console.log("No messages available, skipping retrieveData.");
    }

    // Override the last message to include the context and instructions
    if (messages.length > 0 && context) {
      const documents = context.documents || [];
      // Format documents for the prompt
      const formattedDocuments = documents.map((doc, index) => {
        // Create source identifier with link using example URL pattern
        const sourceId = `source=${index + 1}&link=https://example.com/${encodeURIComponent(doc.source_display_name || doc.filename)}`;
        
        // Return formatted chunk with source
        return `[${sourceId}]\n${doc.text}`;
      }).join('\n\n');

      messages[messages.length - 1].content = `
You are tasked with answering a question using provided chunks of information. Your goal is to provide an accurate answer while citing your sources using a specific markdown format.

Here is the question you need to answer:
<question>
${messages[messages.length - 1].content}
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
    }

   // console.log(`Sending messages to Google Gemini LLM (${model})`, messages);

    // Generate content
    const result = await generativeModel.generateContent(messages[messages.length - 1].content as string);
    console.log("Result from Gemini API:", result);
    
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

    // Fix: Create a stream directly from the responseText instead of using streamText
    // Format the output according to Vercel AI SDK Stream Data format (0: for text)
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
    // Add X-Experimental-Stream-Data header
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