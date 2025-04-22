import React, { useState, useEffect } from 'react';
import DOMPurify from 'dompurify';
import { X, ZoomIn, ExternalLink } from 'lucide-react';

interface DiagramProps {
  svgContent: string;
  title: string;
  sourceUrl: string;
  index: number;
}

const DiagramViewer: React.FC<DiagramProps> = ({ svgContent, title, sourceUrl, index }) => {
  const [isZoomed, setIsZoomed] = useState(false);
  const [sanitizedSvg, setSanitizedSvg] = useState<string>('');
  const [svgError, setSvgError] = useState<string | null>(null);

  // 在组件初始化时打印SVG内容信息
  useEffect(() => {
    if (!svgContent) {
      console.error(`Diagram ${index}: 没有收到SVG内容`);
      setSvgError('没有收到SVG内容');
      return;
    }
    
    console.log(`Diagram ${index}: 收到SVG内容，长度为 ${svgContent.length} 字符`);
    if (svgContent.length < 100) {
      console.warn(`Diagram ${index}: SVG内容异常短: ${svgContent}`);
    }
    
    // 检查SVG有效性
    if (!svgContent.includes('<svg')) {
      console.error(`Diagram ${index}: 内容中没有找到<svg>标签`);
      setSvgError('SVG内容无效，没有找到<svg>标签');
    }
    
    // 尝试清理SVG
    try {
      const cleaned = sanitizeSvg(svgContent);
      setSanitizedSvg(cleaned);
      console.log(`Diagram ${index}: 清理后的SVG长度为 ${cleaned.length} 字符`);
      
      // 如果清理后变空了或没有svg标签
      if (!cleaned || !cleaned.includes('<svg')) {
        console.error(`Diagram ${index}: DOMPurify清理后的SVG无效`);
        setSvgError('DOMPurify可能过滤了重要SVG内容');
      }
    } catch (err) {
      console.error(`Diagram ${index}: 清理SVG时出错:`, err);
      setSvgError(`清理SVG时出错: ${err}`);
    }
  }, [svgContent, index]);

  // 配置 DOMPurify 安全策略 - 扩展以支持更多SVG元素和属性
  const sanitizeSvg = (svg: string) => {
    // 添加更多允许的SVG标签和属性
    const config = {
      ADD_TAGS: [
        'svg', 'path', 'g', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
        'text', 'tspan', 'textPath', 'marker', 'pattern', 'mask', 'clipPath', 'use',
        'defs', 'stop', 'linearGradient', 'radialGradient', 'filter', 'feGaussianBlur',
        'feOffset', 'feBlend', 'feColorMatrix', 'image', 'foreignObject', 'switch',
        'symbol', 'desc', 'title', 'metadata', 'a', 'style'
      ],
      ADD_ATTR: [
        'viewBox', 'd', 'fill', 'stroke', 'x', 'y', 'width', 'height', 'cx', 'cy', 'r',
        'x1', 'y1', 'x2', 'y2', 'transform', 'points', 'font-size', 'font-family',
        'text-anchor', 'dominant-baseline', 'stroke-width', 'stroke-dasharray',
        'stroke-linecap', 'stroke-linejoin', 'opacity', 'fill-opacity', 'xmlns',
        'version', 'xmlns:xlink', 'xlink:href', 'preserveAspectRatio', 'href',
        'style', 'class', 'id', 'markerWidth', 'markerHeight', 'refX', 'refY',
        'orient', 'gradientUnits', 'gradientTransform', 'spreadMethod', 'offset',
        'stop-color', 'stop-opacity', 'patternUnits', 'patternTransform',
        'maskUnits', 'maskContentUnits', 'clipPathUnits', 'filterUnits',
        'fx', 'fy', 'dx', 'dy', 'in', 'in2', 'result', 'mode', 'type', 'values',
        'stdDeviation', 'visibility', 'matrix', 'rotate', 'scale', 'translate',
        'skewX', 'skewY', 'alignment-baseline', 'baseline-shift', 'clip-rule',
        'color-interpolation', 'color-interpolation-filters', 'color-profile',
        'color-rendering', 'cursor', 'direction', 'fill-rule', 'filter', 'glyph-orientation-horizontal',
        'glyph-orientation-vertical', 'image-rendering', 'kerning', 'letter-spacing',
        'lighting-color', 'marker-end', 'marker-mid', 'marker-start', 'mask', 'pointer-events',
        'shape-rendering', 'stroke-dashoffset', 'stroke-miterlimit', 'stroke-opacity',
        'text-decoration', 'vector-effect', 'word-spacing', 'writing-mode'
      ],
      FORCE_BODY: false,  // 不强制包装在body标签中
      WHOLE_DOCUMENT: true, // 处理整个文档
      RETURN_DOM: false, // 返回字符串
      RETURN_DOM_FRAGMENT: false, // 返回DOM片段
      SANITIZE_DOM: true,
    };
    
    // 确保DOMPurify已准备好
    if (typeof window !== 'undefined') {
      DOMPurify.addHook('afterSanitizeAttributes', function(node) {
        // 如果是SVG元素，添加命名空间
        if (node.tagName === 'svg') {
          node.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        }
      });
    }
    
    return DOMPurify.sanitize(svg, config);
  };

  // 直接使用img标签展示SVG的备用方案
  const renderAsFallback = () => {
    try {
      // 创建blob URL
      const blob = new Blob([svgContent], { type: 'image/svg+xml' });
      const svgUrl = URL.createObjectURL(blob);
      
      return (
        <img 
          src={svgUrl} 
          alt={`${title}`} 
          onError={(e) => {
            console.error(`图表 ${index} 使用img标签渲染也失败了`);
            URL.revokeObjectURL(svgUrl);
          }}
          onLoad={() => console.log(`图表 ${index} 使用img标签成功渲染`)}
          className="w-full h-auto"
        />
      );
    } catch (err) {
      console.error(`创建SVG Blob失败:`, err);
      return <div className="text-red-500">无法渲染SVG</div>;
    }
  };

  return (
    <>
      <div className="border border-gray-300 dark:border-gray-700 rounded-md p-4 my-3 bg-gray-50 dark:bg-gray-800 shadow-sm overflow-hidden">
        <div className="flex justify-between items-center mb-2">
          <h4 className="text-md font-semibold text-gray-800 dark:text-gray-200 truncate" title={title}>
            Diagram {index}: {title}
          </h4>
          <div className="flex space-x-2">
            <button 
              onClick={() => setIsZoomed(true)} 
              className="p-1 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-white transition-colors"
              title="Zoom diagram"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
          </div>
        </div>
        
        {svgError ? (
          <div className="text-red-500 mb-2">
            错误: {svgError}
            <div className="mt-2">{renderAsFallback()}</div>
          </div>
        ) : (
          <div 
            className="overflow-auto max-h-60 bg-white dark:bg-gray-700 p-2 rounded cursor-pointer" 
            onClick={() => setIsZoomed(true)}
          >
            {sanitizedSvg ? (
              <div className="svg-container w-full" dangerouslySetInnerHTML={{ __html: sanitizedSvg.replace('<svg', '<svg width="100%" height="100%" preserveAspectRatio="xMidYMid meet"') }} />
            ) : (
              <div className="flex justify-center items-center h-20">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
              </div>
            )}
          </div>
        )}
        
        {sourceUrl && (
          <div className="mt-2 text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center">
            <a href={sourceUrl} target="_blank" rel="noopener noreferrer" title={`View original diagram at ${sourceUrl}`} className="flex items-center">
              <ExternalLink className="w-3 h-3 mr-1" />
              View original diagram
            </a>
          </div>
        )}
      </div>

      {/* 放大查看模态框 */}
      {isZoomed && (
        <div 
          className="fixed inset-0 bg-black/70 dark:bg-gray-900/80 flex items-center justify-center z-50 backdrop-blur-sm overflow-auto p-4"
          onClick={() => setIsZoomed(false)}
        >
          <div 
            className="bg-white dark:bg-gray-800 p-4 rounded-lg max-w-5xl w-full max-h-[90vh] overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-3 border-b border-gray-200 dark:border-gray-700 pb-2">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{title}</h3>
              <button
                onClick={() => setIsZoomed(false)}
                className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="bg-white dark:bg-gray-700 p-4 rounded-lg">
              {svgError ? (
                <div>
                  <div className="text-red-500 mb-4">错误: {svgError}</div>
                  {renderAsFallback()}
                </div>
              ) : (
                sanitizedSvg ? (
                  <div className="svg-container w-full max-w-full overflow-auto" dangerouslySetInnerHTML={{ __html: sanitizedSvg.replace('<svg', '<svg width="100%" height="100%" preserveAspectRatio="xMidYMid meet"') }} />
                ) : (
                  <div className="flex justify-center items-center h-40">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
                  </div>
                )
              )}
            </div>
            <div className="mt-4 flex justify-between items-center">
              {sourceUrl && (
                <a 
                  href={sourceUrl} 
                  target="_blank" 
                  rel="noopener noreferrer" 
                  className="text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 flex items-center"
                >
                  <ExternalLink className="w-4 h-4 mr-1" />
                  查看BIAN原始文档
                </a>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default DiagramViewer; 