import React, { useEffect, useRef } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import DOMPurify from 'dompurify';
import DiagramViewer from './DiagramViewer';
import { DiagramDocument } from '../services/diagramService';

interface ChatMessageProps {
  content: string;
  diagrams: DiagramDocument[];
}

const ChatMessage: React.FC<ChatMessageProps> = ({ content, diagrams }) => {
  const messageRef = useRef<HTMLDivElement>(null);
  
  // 存储已处理的图表索引，避免重复渲染
  const processedDiagramsRef = useRef<Set<number>>(new Set());

  // 检测图表引用并替换为实际图表
  const findDiagramReferences = () => {
    if (!messageRef.current || diagrams.length === 0) return;

    const diagramPattern = /\[See Diagram (\d+): ([^\]]+)\]/g;
    const html = messageRef.current.innerHTML;
    const replacements: Array<[string, string]> = [];
    
    let match;
    while ((match = diagramPattern.exec(html)) !== null) {
      const fullMatch = match[0];
      const diagramIndex = parseInt(match[1], 10);
      
      // 检查是否已处理过该图表，避免重复
      if (processedDiagramsRef.current.has(diagramIndex)) {
        // 如果已处理过，替换为空字符串
        replacements.push([fullMatch, '']);
        continue;
      }
      
      // 查找对应的图表
      const diagram = diagrams.find(d => d.index === diagramIndex || diagrams.indexOf(d) + 1 === diagramIndex);
      
      if (diagram) {
        // 标记为已处理
        processedDiagramsRef.current.add(diagramIndex);
        // 使用占位符，之后将被DiagramViewer替换
        replacements.push([fullMatch, `<div class="diagram-placeholder" data-diagram-index="${diagramIndex - 1}"></div>`]);
      }
    }

    // 应用替换
    let newHtml = html;
    for (const [pattern, replacement] of replacements) {
      newHtml = newHtml.replace(pattern, replacement);
    }
    
    if (replacements.length > 0) {
      messageRef.current.innerHTML = newHtml;
      
      // 遍历所有占位符，插入DiagramViewer
      const placeholders = messageRef.current.querySelectorAll('.diagram-placeholder');
      placeholders.forEach((placeholder) => {
        const index = parseInt(placeholder.getAttribute('data-diagram-index') || '0', 10);
        const diagram = diagrams[index];
        
        if (diagram) {
          // 创建DiagramViewer
          const diagramContainer = document.createElement('div');
          placeholder.appendChild(diagramContainer);
          
          // 使用React渲染
          import('react-dom/client').then(({ createRoot }) => {
            const root = createRoot(diagramContainer);
            root.render(
              <DiagramViewer 
                svgContent={diagram.svg_content}
                title={diagram.source_display_name || diagram.filename || `BIAN Diagram ${index + 1}`}
                sourceUrl={diagram.source_url || ''}
                index={index + 1}
              />
            );
          });
        }
      });
    }
  };

  // 在内容或图表数据变化时重置已处理图表集合
  useEffect(() => {
    processedDiagramsRef.current = new Set();
    // 使用requestAnimationFrame确保DOM已经渲染完毕
    requestAnimationFrame(() => {
      findDiagramReferences();
    });
  }, [content, diagrams]);

  // 使用DOMPurify清理markdown渲染输出
  const sanitizeMarkdown = (html: string) => {
    const config = {
      ADD_TAGS: ['div', 'span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'table', 'tr', 'td', 'th', 'thead', 'tbody', 'pre', 'code', 'em', 'strong', 'a', 'br', 'hr'],
      ADD_ATTR: ['href', 'target', 'rel', 'class', 'id']
    };
    return DOMPurify.sanitize(html, config);
  };

  // 移除结尾的图表引用，因为它们会被处理为真实图表
  const cleanContent = () => {
    let cleanedContent = content;
    // 查找并移除结尾处的所有图表引用
    const matches = [...content.matchAll(/\[See Diagram \d+:[^\]]+\]\s*$/g)];
    if (matches.length > 0) {
      // 移除最后一个图表引用
      const lastMatch = matches[matches.length - 1];
      cleanedContent = content.substring(0, lastMatch.index).trim();
    }
    return cleanedContent;
  };

  return (
    <div className="chat-message w-full">
      <div ref={messageRef} className="w-full overflow-hidden">
        <Markdown
          remarkPlugins={[remarkGfm]}
          components={{
            // 自定义链接渲染
            a: ({ node, ...props }) => (
              <a
                {...props}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 dark:text-blue-400 hover:underline"
              />
            ),
            // 自定义代码块渲染
            code: ({ node, className, children, ...props }) => {
              const match = /language-(\w+)/.exec(className || '');
              return match ? (
                <pre className="bg-gray-100 dark:bg-gray-800 p-3 rounded-md overflow-auto">
                  <code className={className} {...props}>
                    {children}
                  </code>
                </pre>
              ) : (
                <code className="bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded text-sm" {...props}>
                  {children}
                </code>
              );
            }
          }}
        >
          {cleanContent()}
        </Markdown>
      </div>
    </div>
  );
};

export default ChatMessage; 