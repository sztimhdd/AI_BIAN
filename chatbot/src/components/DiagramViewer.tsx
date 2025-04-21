import React from 'react';

interface DiagramProps {
  svgContent: string;
  title: string;
  sourceUrl: string;
}

const DiagramViewer: React.FC<DiagramProps> = ({ svgContent, title, sourceUrl }) => {
  // 基本的SVG清理或验证可以在这里添加
  // 例如，确保它包含 <svg> 标签
  const sanitizedSvg = svgContent; // 暂时不做复杂处理

  return (
    <div className="border border-gray-300 dark:border-gray-700 rounded-md p-4 my-3 bg-gray-50 dark:bg-gray-800 shadow-sm overflow-hidden">
      <h4 className="text-md font-semibold mb-2 text-gray-800 dark:text-gray-200 truncate" title={title}>{title}</h4>
      <div 
        className="overflow-auto max-h-60 bg-white dark:bg-gray-700 p-2 rounded" // 添加背景色以便查看透明SVG，限制最大高度
        // 使用 dangerouslySetInnerHTML 时要确保SVG内容是可信的
        // 我们的API应该只返回我们自己生成的或清理过的SVG
        dangerouslySetInnerHTML={{ __html: sanitizedSvg }}
      />
      {sourceUrl && (
        <div className="mt-2 text-xs text-blue-600 dark:text-blue-400 hover:underline">
          <a href={sourceUrl} target="_blank" rel="noopener noreferrer" title={`View original diagram at ${sourceUrl}`}>
            查看原始图表
          </a>
        </div>
      )}
    </div>
  );
};

export default DiagramViewer; 