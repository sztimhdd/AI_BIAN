import React from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import DiagramViewer from './DiagramViewer';
import { DiagramDocument } from '../services/diagramService';

interface ChatMessageProps {
  content: string;
  diagrams: DiagramDocument[];
}

interface ContentSegment {
  type: 'text' | 'diagram';
  value?: string; // For text segments
  diagram?: DiagramDocument; // For diagram segments
  diagramIndex?: number; // Original index from reference
}

const ChatMessage: React.FC<ChatMessageProps> = ({ content, diagrams }) => {

  const parseContent = (): ContentSegment[] => {
    const segments: ContentSegment[] = [];
    const diagramPattern = /\[See Diagram (\d+): ([^\]]+)\]/g;
    let lastIndex = 0;
    let match;

    while ((match = diagramPattern.exec(content)) !== null) {
      // Add preceding text segment if it exists
      if (match.index > lastIndex) {
        segments.push({ 
          type: 'text', 
          value: content.substring(lastIndex, match.index) 
        });
      }

      // Find the corresponding diagram
      const diagramIndex = parseInt(match[1], 10);
      const diagram = diagrams.find((d, idx) => idx + 1 === diagramIndex);

      // Add diagram segment if found
      if (diagram) {
        segments.push({ type: 'diagram', diagram: diagram, diagramIndex: diagramIndex });
      } else {
        // If diagram not found, maybe add the reference text back?
        // Or just omit it. Let's omit for now.
        console.warn(`Diagram with index ${diagramIndex} not found for reference: ${match[0]}`);
      }
      
      lastIndex = match.index + match[0].length;
    }

    // Add remaining text segment if it exists
    if (lastIndex < content.length) {
      segments.push({ 
        type: 'text', 
        value: content.substring(lastIndex) 
      });
    }
    
    // Filter out empty text segments that might occur
    return segments.filter(seg => seg.type === 'diagram' || (seg.type === 'text' && seg.value?.trim()));
  };

  const contentSegments = parseContent();

  return (
    <div className="chat-message w-full flex flex-col">
      {contentSegments.map((segment, index) => {
        if (segment.type === 'text') {
          return (
            <div key={`text-${index}`} className="prose prose-sm md:prose-base dark:prose-invert max-w-none break-words prose-p:my-4 prose-ul:my-4 prose-ol:my-4 w-full">
              <Markdown
                remarkPlugins={[remarkGfm]}
                components={{
                  // Custom renderers if needed (e.g., links, code)
                   a: ({ node, ...props }) => (
                    <a
                      {...props}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 dark:text-blue-400 hover:underline"
                    />
                  ),
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
                {segment.value}
              </Markdown>
            </div>
          );
        } else if (segment.type === 'diagram' && segment.diagram) {
          return (
            <div key={`diagram-${segment.diagramIndex || index}`} className="w-full my-4"> {/* Add margin top/bottom */}
              <DiagramViewer
                svgContent={segment.diagram.svg_content}
                title={segment.diagram.source_display_name || segment.diagram.filename || `BIAN Diagram ${segment.diagramIndex}`}
                sourceUrl={segment.diagram.source_url || ''}
                index={segment.diagramIndex || 0} // Use original index
              />
            </div>
          );
        }
        return null; // Should not happen with filtering
      })}
    </div>
  );
};

export default ChatMessage; 