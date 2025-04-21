// src/services/diagramService.ts
export interface DiagramDocument {
  text: string;
  filename: string;
  source_display_name: string;
  svg_content: string;
  source_url: string;
  metadata: Record<string, any>;
}

export interface DiagramRetrievalResponse {
  documents: DiagramDocument[];
}

// 从环境变量获取API URL，如果未设置则使用默认值
const DIAGRAM_API_URL = process.env.NEXT_PUBLIC_DIAGRAM_API_URL || 'http://localhost:8000/retrieve_diagrams';

export async function retrieveDiagrams(query: string, numResults: number = 3): Promise<DiagramRetrievalResponse> {
  try {
    console.log(`Querying Diagram API at ${DIAGRAM_API_URL} for: "${query}"`);
    const response = await fetch(DIAGRAM_API_URL, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Accept': 'application/json' // 明确接受JSON响应
      },
      body: JSON.stringify({
        question: query,
        numResults,
        rerank: true // 假设总是需要重排
      })
    });
  
    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`Diagram retrieval failed with status ${response.status}: ${errorBody}`);
      // 根据状态码或错误内容可以进行更细致的错误处理
      throw new Error(`图表检索失败: ${response.statusText}`);
    }
  
    // 确保响应是JSON
    const contentType = response.headers.get("content-type");
    if (!contentType || !contentType.includes("application/json")) {
      const textResponse = await response.text();
      console.error("Received non-JSON response from diagram API:", textResponse);
      throw new Error("从图表 API 收到了非 JSON 响应");
    }

    const data: DiagramRetrievalResponse = await response.json();
    console.log(`Successfully retrieved ${data.documents?.length ?? 0} diagrams.`);
    return data;

  } catch (error) {
    console.error('Error calling retrieveDiagrams:', error);
    // 可以返回一个空的响应或重新抛出错误，取决于调用者的错误处理方式
    // 这里我们返回一个空数组，让调用者决定如何处理
    return { documents: [] }; 
    // 或者 rethrow: throw error;
  }
} 