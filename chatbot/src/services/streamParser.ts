import { DiagramDocument } from './diagramService';

/**
 * 用于表示流处理状态的接口
 */
export interface StreamParserState {
  text: string;
  diagrams: DiagramDocument[];
  isComplete: boolean;
}

/**
 * 初始化解析器状态
 */
export const initialStreamParserState: StreamParserState = {
  text: '',
  diagrams: [],
  isComplete: false,
};

/**
 * 清理JSON字符串，确保其可以被正确解析
 */
function sanitizeJsonString(jsonStr: string): string {
  try {
    // 尝试移除多余的非JSON字符
    let cleaned = jsonStr.trim();
    
    // 如果不是以{开头，尝试找到第一个{
    const firstBrace = cleaned.indexOf('{');
    if (firstBrace > 0) {
      cleaned = cleaned.substring(firstBrace);
    }
    
    // 如果不是以}结尾，尝试找到最后一个}
    const lastBrace = cleaned.lastIndexOf('}');
    if (lastBrace > 0 && lastBrace < cleaned.length - 1) {
      cleaned = cleaned.substring(0, lastBrace + 1);
    }
    
    return cleaned;
  } catch (e) {
    console.error('Error sanitizing JSON string:', e);
    return jsonStr;
  }
}

/**
 * 处理转义字符，将JSON字符串中的转义序列转换为实际字符
 */
function unescapeString(str: string): string {
  // 替换常见的转义序列
  return str
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\')
    .replace(/\\'/g, "'");
}

/**
 * 处理自定义流响应
 * @param response - Fetch API响应对象
 * @param onUpdate - 当解析器状态更新时的回调
 */
export async function processCustomStream(
  response: Response,
  onUpdate: (state: StreamParserState) => void
) {
  if (!response.body) {
    throw new Error('Response body is null');
  }
  
  let buffer = '';
  let collectingDiagrams = false;
  let diagramsJson = '';
  let parserState: StreamParserState = { ...initialStreamParserState };
  
  try {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    
    while (true) {
      const { done, value } = await reader.read();
      
      if (done) {
        // 流结束，处理最后的数据
        if (diagramsJson) {
          try {
            const sanitizedJson = sanitizeJsonString(diagramsJson);
            console.log('流结束时处理图表数据:', sanitizedJson.length);
            const parsedData = JSON.parse(sanitizedJson);
            
            if (parsedData.diagrams && Array.isArray(parsedData.diagrams)) {
              console.log(`解析到 ${parsedData.diagrams.length} 个图表`);
              
              // 对每个图表进行字段标准化
              const normalizedDiagrams = parsedData.diagrams.map((diagram: any, index: number) => {
                // 确保字段名一致
                if (!diagram.svg_content && diagram.svg) {
                  diagram.svg_content = diagram.svg;
                }
                if (!diagram.source_url && diagram.url) {
                  diagram.source_url = diagram.url;
                }
                
                return {
                  ...diagram,
                  index: index + 1
                };
              });
              
              parserState = {
                ...parserState,
                diagrams: normalizedDiagrams
              };
            }
          } catch (e) {
            console.error('处理图表数据出错:', e);
          }
        }
        
        // 流结束时不再进行额外的文本处理，保留原始格式
        parserState = {
          ...parserState,
          isComplete: true
        };
        onUpdate(parserState);
        break;
      }
      
      // 解码当前块
      const chunk = decoder.decode(value, { stream: true });
      
      // 检测图表数据
      if (chunk.includes('diagrams-start')) {
        collectingDiagrams = true;
        const parts = chunk.split('diagrams-start');
        
        // 处理文本部分，最小化处理以保留原始格式
        if (parts[0]) {
          // 如果文本部分以0:"开头，移除前缀
          let textPart = parts[0];
          if (textPart.startsWith('0:"')) {
            textPart = textPart.substring(3);
            if (textPart.endsWith('"')) {
              textPart = textPart.substring(0, textPart.length - 1);
            }
            // 只替换特定转义字符
            textPart = textPart.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
          }
          
          buffer += textPart;
          parserState = { ...parserState, text: buffer };
          onUpdate(parserState);
        }
        
        // 开始收集图表数据
        diagramsJson = parts[1] || '';
      } 
      else if (collectingDiagrams && chunk.includes('diagrams-end')) {
        const parts = chunk.split('diagrams-end');
        diagramsJson += parts[0] || '';
        
        try {
          // 清理并解析图表数据
          const sanitizedJson = sanitizeJsonString(diagramsJson);
          const parsedData = JSON.parse(sanitizedJson);
          
          if (parsedData.diagrams && Array.isArray(parsedData.diagrams)) {
            // 对每个图表进行字段标准化
            const normalizedDiagrams = parsedData.diagrams.map((diagram: any, index: number) => {
              // 确保字段名一致
              if (!diagram.svg_content && diagram.svg) {
                diagram.svg_content = diagram.svg;
              }
              if (!diagram.source_url && diagram.url) {
                diagram.source_url = diagram.url;
              }
              
              return {
                ...diagram,
                index: index + 1
              };
            });
            
            parserState = {
              ...parserState,
              diagrams: normalizedDiagrams
            };
            onUpdate(parserState);
          }
        } catch (e) {
          console.error('解析图表数据出错:', e);
        }
        
        // 重置图表收集状态
        collectingDiagrams = false;
        diagramsJson = '';
        
        // 继续处理文本部分，最小化处理以保留原始格式
        if (parts[1]) {
          let textPart = parts[1];
          if (textPart.startsWith('0:"')) {
            textPart = textPart.substring(3);
            if (textPart.endsWith('"')) {
              textPart = textPart.substring(0, textPart.length - 1);
            }
            // 只替换特定转义字符
            textPart = textPart.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
          }
          
          buffer += textPart;
          parserState = { ...parserState, text: buffer };
          onUpdate(parserState);
        }
      }
      else if (collectingDiagrams) {
        // 收集图表数据
        diagramsJson += chunk;
      }
      else {
        // 处理纯文本
        let cleanedChunk = chunk;
        
        // 处理API前缀格式 - 仅移除前缀，保留原始格式
        if (cleanedChunk.startsWith('0:"')) {
          cleanedChunk = cleanedChunk.substring(3);
          
          if (cleanedChunk.endsWith('"')) {
            cleanedChunk = cleanedChunk.substring(0, cleanedChunk.length - 1);
          }
          
          // 只替换反斜杠和引号转义
          cleanedChunk = cleanedChunk.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
        }
        
        // 更新缓冲区和状态，保留原始格式
        buffer += cleanedChunk;
        parserState = { ...parserState, text: buffer };
        onUpdate(parserState);
      }
    }
  } catch (error) {
    console.error('流处理出错:', error);
    
    // 即使出错也标记为完成
    parserState = { ...parserState, isComplete: true };
    onUpdate(parserState);
    
    throw error;
  }
}

/**
 * 创建自定义流处理函数 - 仅用于向后兼容，实际流处理移到processCustomStream中
 * @param onUpdate - 当流处理状态更新时的回调
 * @returns 一个可以处理ReadableStream的函数
 */
export function createStreamParser(
  onUpdate: (state: StreamParserState) => void
) {
  return async function processStream(reader: ReadableStreamDefaultReader<Uint8Array>) {
    // 这个函数不再包含主要逻辑，仅用于保持向后兼容
    try {
      const decoder = new TextDecoder();
      let buffer = '';
      
      while (true) {
        const { done, value } = await reader.read();
        
        if (done) {
          onUpdate({ text: buffer, diagrams: [], isComplete: true });
          break;
        }
        
        const chunk = decoder.decode(value, { stream: true });
        buffer += unescapeString(chunk);
        onUpdate({ text: buffer, diagrams: [], isComplete: false });
      }
    } catch (error) {
      console.error('流处理错误:', error);
      onUpdate({ text: '', diagrams: [], isComplete: true });
    }
  };
} 