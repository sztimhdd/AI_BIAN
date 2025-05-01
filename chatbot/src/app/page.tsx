"use client";

import { Message, useChat } from "@ai-sdk/react";
import Markdown from "react-markdown";
import { useState, useRef, useEffect } from "react";
import remarkGfm from "remark-gfm";
import { AlertCircle, ChevronDown, Trash2, RefreshCw, XCircle, Moon, Sun, Send, Menu, X, Info, ExternalLink, MessageSquare, Zap, Map, Globe } from "lucide-react";
import { retrieveDiagrams, DiagramDocument } from "../services/diagramService";
import DiagramViewer from "../components/DiagramViewer";
import ChatMessage from '../components/ChatMessage';
import { processCustomStream, StreamParserState, initialStreamParserState } from '../services/streamParser';

interface PlaceholderOption {
  emoji: string;
  text: string;
}

// Full pool of placeholder questions
const allPlaceholderOptions: PlaceholderOption[] = [
  // Original 5
  { emoji: "🎯", text: "What is the primary purpose of the BIAN Service Landscape?" },
  { emoji: "🔗", text: "Explain the difference between a Service Domain and a Service Operation in BIAN terminology." },
  { emoji: "💻", text: "How does BIAN's framework support API development in banking systems?" },
  { emoji: "🗺️", text: "Describe the relationship between Business Scenarios and Service Operations in BIAN." },
  { emoji: "🏗️", text: "What are the core design principles that underpin the BIAN framework?" },
  // New 10
  { emoji: "🧩", text: "What are the key components of the BIAN reference architecture, and how do they relate to each other?" },
  { emoji: "🗺️", text: "How can we map our existing business capabilities and services to the BIAN service landscape?" },
  { emoji: "📈", text: "What are the primary benefits of adopting BIAN for our financial institution, and how can we measure the ROI?" },
  { emoji: "🛠️", text: "What is the recommended approach for implementing BIAN in our organization, including any tools or methodologies provided?" },
  { emoji: "🤝", text: "How does BIAN integrate with other industry standards or frameworks we are using, such as TOGAF or ArchiMate?" },
  { emoji: "🏦", text: "Can you provide examples or case studies of financial institutions that have successfully implemented BIAN?" },
  { emoji: "🎓", text: "What training and certification programs are available for our architects and developers to learn BIAN?" },
  { emoji: "🚀", text: "What is the roadmap for BIAN's future development, and how will it impact our implementation?" },
  { emoji: "🔗", text: "How does BIAN support open banking initiatives and the development of APIs for financial services?" },
  { emoji: "🌐", text: "What kind of community support and resources are available to BIAN members?" },
  // Rewritten 10 questions based on user feedback
  { emoji: "🔗", text: "Relationship between BIAN Business Capabilities, Service Domains, Business Objects, and mapping example for loan origination?" },
  { emoji: "🔍", text: "Steps to assess current architecture, map to BIAN Service Landscape, and identify service domain gaps?" },
  { emoji: "🧩", text: "Describe integrating BIAN with TOGAF, focusing on resolving terminology and structural conflicts." },
  { emoji: "💻", text: "Approach for designing a BIAN-compliant Semantic API for core banking? Potential legacy system interoperability challenges?" },
  { emoji: "📊", text: "Strategies to prioritize BIAN service domain adoption based on cost, compliance, and business value?" },
  { emoji: "🏦", text: "Example of BIAN implementation streamlining financial institution operations, including tools and methodologies?" },
  { emoji: "📐", text: "How does the BIAN UML metamodel support banking service design? What are its practical benefits?" },
  { emoji: "🌐", text: "BIAN's role in open banking/API ecosystems? How to leverage it for competitive positioning?" },
  { emoji: "🎓", text: "Training approaches for BIAN architecture and post-implementation maintenance? Recommended certifications?" },
  { emoji: "📈", text: "Key considerations for evolving BIAN architecture over time, considering digital transformation and landscape changes?" },
  // New diagram-focused questions
  { emoji: "🔄", text: "Explain interaction patterns: Customer Onboarding & related Service Domains. Show diagram." },
  { emoji: "💳", text: "Show structural diagram: Payment Execution Service Domain & integration with Clearing/Settlement for BIAN payment design." },
  { emoji: "📋", text: "Show relationship diagram: Product Directory, Design, Pricing Service Domains. Explain collaboration for Product Lifecycle Management." },
  { emoji: "📡", text: "Difference: Request-Response vs Notification patterns in BIAN Service Operations? Show example diagrams." },
  { emoji: "🔒", text: "Present BIAN Service Domain diagram for Risk Management: relationships/flows between Fraud Detection, Compliance Check, Transaction Authorization." },
  { emoji: "🔐", text: "How should BIAN implement Digital Identity, Authentication & KYC? Show diagrams of involved Service Domains & interaction sequences." },
  { emoji: "🌍", text: "Show diagrams for BIAN Open Banking API architecture: API Gateway interaction with Service Domains for AIS & PIS." },
  { emoji: "📊", text: "How are Business Scenarios mapped to Service Domains in BIAN? Show Service Domain constellation diagram for Wealth Management." },
  { emoji: "📨", text: "Illustrate BIAN event-driven integration pattern with diagram. Explain how event handling/publishing/subscription support loosely coupled communication." },
  { emoji: "📱", text: "BIAN integration patterns: Core Banking & Digital Channels? Show diagram for Channel Mgmt, Customer Interaction, Product Servicing domains." },
];

// Function to get N random items from an array
function getRandomItems<T>(arr: T[], n: number): T[] {
  if (n > arr.length) {
    console.warn("Cannot select more items than available in the array.");
    return [...arr]; // Return a copy of the original array if n is too large
  }
  const shuffled = [...arr].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, n);
}

const formatJSON = (obj: Record<string, unknown>) => {
  const processValue = (value: unknown, level: number): string => {
    const indent = "  ".repeat(level);

    if (value === null) {
      return `<span class="text-gray-400">null</span>`;
    }
    if (value === undefined) {
      return `<span class="text-red-400">undefined</span>`;
    }

    if (Array.isArray(value)) {
      if (value.length === 0) return `<span class="text-gray-300">[]</span>`;
      const items = value.map((item) => `${indent}  ${processValue(item, level + 1)}`).join(",\n");
      return `<span class="text-gray-300">[</span>\n${items}\n${indent}<span class="text-gray-300">]</span>`;
    }

    if (value && typeof value === "object") {
      const entries = Object.entries(value);
      if (entries.length === 0) return `<span class="text-gray-300">{}</span>`;

      const formattedEntries = entries
        .map(([key, val]) => {
          const formattedKey = `<span class="text-blue-400">"${key}"</span>`;
          return `${indent}  ${formattedKey}: ${processValue(val, level + 1)}`;
        })
        .join(",\n");

      return `<span class="text-gray-300">{</span>\n${formattedEntries}\n${indent}<span class="text-gray-300">}</span>`;
    }

    if (typeof value === "string") {
      const escaped = value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
      return `<span class="text-green-400">"${escaped}"</span>`;
    }

    if (typeof value === "number") {
      return `<span class="text-yellow-400">${value}</span>`;
    }

    if (typeof value === "boolean") {
      return `<span class="text-purple-400">${value}</span>`;
    }

    return `<span class="text-red-400">${String(value)}</span>`;
  };

  return `<pre class="font-mono text-sm whitespace-pre">${processValue(obj, 0)}</pre>`;
};

export default function Page() {
  const { messages, setMessages, input, handleInputChange, isLoading: aiSdkLoading, error, append } = useChat({
    onError: (error) => {
      console.error("Chat error:", error);
      setErrorMessage(error.message || "An error occurred while processing your request.");
    },
    experimental_throttle: 250
  });
  
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);
  const [selectedOption, setSelectedOption] = useState<PlaceholderOption | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [showPlaceholders, setShowPlaceholders] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [randomPlaceholders, setRandomPlaceholders] = useState<PlaceholderOption[]>([]); // State for random placeholders
  const [darkMode, setDarkMode] = useState<boolean>(false); // 默认使用浅色主题作为初始值
  const [showHero, setShowHero] = useState(true);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [showIntroPanel, setShowIntroPanel] = useState(true);
  const [showResourcesDropdown, setShowResourcesDropdown] = useState(false);
  const [showAboutModal, setShowAboutModal] = useState(false);
  const [diagramsByMessageId, setDiagramsByMessageId] = useState<Record<string, DiagramDocument[]>>({});
  
  // 添加自定义加载状态
  const [isLoading, setIsLoading] = useState(false);
  
  const resourcesDropdownRef = useRef<HTMLDivElement>(null);

  // 添加新的状态用于方案B流处理
  const [streamStates, setStreamStates] = useState<Record<string, StreamParserState>>({});
  
  // 在客户端检测首选的颜色方案并相应地设置暗色模式
  useEffect(() => {
    // 检查系统颜色首选项
    const isDarkMode = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    setDarkMode(isDarkMode);
    
    // 添加颜色方案变化的监听器
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (e: MediaQueryListEvent) => {
      setDarkMode(e.matches);
    };
    
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []); // 空依赖数组确保这只在客户端首次渲染时运行

  // Toggle dark mode - 保留这个功能
  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);

  // Select random placeholders on component mount
  useEffect(() => {
    setRandomPlaceholders(getRandomItems(allPlaceholderOptions, 5));
  }, []); // Empty dependency array ensures this runs only once on mount

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (resourcesDropdownRef.current && !resourcesDropdownRef.current.contains(event.target as Node)) {
        setShowResourcesDropdown(false);
      }
    }
    
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  // Effect to fetch diagrams when a new user message appears
  useEffect(() => {
    const lastMessage = messages[messages.length - 1];
    // Only act on new user messages for which we haven't checked diagrams yet
    if (lastMessage && lastMessage.role === 'user' && diagramsByMessageId[lastMessage.id] === undefined) { 
      const query = lastMessage.content;
      // Basic keyword check to decide if a diagram search is relevant
      const potentiallyNeedsDiagram = 
        query.toLowerCase().includes('diagram') || 
        query.toLowerCase().includes('show me') ||
        query.toLowerCase().includes('visualize') ||
        query.toLowerCase().includes('service domain') || 
        query.toLowerCase().includes('landscape') ||
        query.toLowerCase().includes('architecture'); 

      if (potentiallyNeedsDiagram) {
         console.log(`Diagram search triggered for user message ID: ${lastMessage.id}, Query: "${query}"`);
         // Set state immediately to indicate searching is in progress (prevents re-triggering)
         setDiagramsByMessageId(prev => ({ ...prev, [lastMessage.id]: [] })); // Use empty array as placeholder

         retrieveDiagrams(query)
           .then(response => {
             if (response.documents && response.documents.length > 0) {
               console.log(`Found ${response.documents.length} diagrams for message ${lastMessage.id}`);
               setDiagramsByMessageId(prev => ({
                 ...prev,
                 [lastMessage.id]: response.documents
               }));
             } else {
               console.log(`No diagrams found for message ${lastMessage.id}`);
               // Keep the empty array to indicate search completed with no results
             }
           })
           .catch(error => {
             console.error(`Error retrieving diagrams for message ${lastMessage.id}:`, error);
             // Keep empty array on error as well
           });
      } else {
         // Mark as checked, no search needed
         console.log(`Diagram search skipped for user message ID: ${lastMessage.id}`);
         setDiagramsByMessageId(prev => ({ ...prev, [lastMessage.id]: [] }));
      }
    }
  // Depend on messages array and the state itself to avoid potential issues
  }, [messages, diagramsByMessageId]); 

  const handleNewChat = () => {
    setMessages([]);
    setShowPlaceholders(true);
    setErrorMessage(null);
    setShowIntroPanel(true);
    setStreamStates({}); // 清空流状态
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    setShouldAutoScroll(true);
  };

  const handleScroll = () => {
    if (!messagesContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = messagesContainerRef.current;
    const isAtBottom = Math.abs(scrollHeight - clientHeight - scrollTop) < 10;
    setShouldAutoScroll(isAtBottom);
    setShowScrollButton(!isAtBottom);
  };

  useEffect(() => {
    if (shouldAutoScroll) {
      scrollToBottom();
    }
  }, [messages, shouldAutoScroll]);

  useEffect(() => {
    if (error) {
      setErrorMessage(error.message || "An error occurred while processing your request.");
    }
  }, [error]);

  useEffect(() => {
    if (messages.length > 0) {
      setShowHero(false);
      setShowIntroPanel(false);
    }
  }, [messages]);

  const handleOptionSelect = async (option: PlaceholderOption) => {
    setSelectedOption(option);
    setShowPlaceholders(false);
    setErrorMessage(null);
    setShowHero(false);
    setShowIntroPanel(false);
    
    try {
      // 设置加载状态
      setIsLoading(true);
      
      // 创建唯一ID
      const messageId = Date.now().toString();
      
      // 创建用户消息并添加到消息列表
      const userMessage: Message = { id: messageId, role: "user", content: option.text };
      
      // 更新消息
      setMessages((prev) => [...prev, userMessage]);
      
      // 初始化助手消息
      const assistantMessageId = messageId + "_assistant";
      setMessages((prev) => [...prev, { id: assistantMessageId, role: "assistant", content: "" } as Message]);
      
      // 初始化流状态
      setStreamStates((prev) => ({
        ...prev,
        [assistantMessageId]: { ...initialStreamParserState }
      }));
      
      // 发送请求 - 使用 fetch 而非 append
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [...messages, userMessage] // 发送包含新用户消息的完整历史
        })
      });
      
      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
      }
      
      // 处理自定义流
      await processCustomStream(response, (state) => {
        setStreamStates((prev) => ({
          ...prev,
          [assistantMessageId]: state
        }));
        
        // 更新消息内容
        setMessages((prev) => 
          prev.map((msg) => 
            msg.id === assistantMessageId 
              ? { ...msg, content: state.text } as Message
              : msg
          )
        );
      });

      // 完成后关闭加载状态
      setIsLoading(false);

    } catch (err: any) {
      console.error("Error sending placeholder message:", err);
      setErrorMessage(err.message || "An error occurred while processing your request.");
      // 错误时也要关闭加载状态
      setIsLoading(false);
    }
  };

  // 自定义表单提交处理
  const handleFormSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    
    setErrorMessage(null);
    if (input.trim()) {
      setShowHero(false);
      setShowIntroPanel(false);
    }

    try {
      // 设置加载状态
      setIsLoading(true);
      
      // 创建唯一ID
      const messageId = Date.now().toString();
      
      // 创建用户消息并添加到消息列表
      const userMessage: Message = { id: messageId, role: "user", content: input };
      
      // 清空输入框
      const currentInput = input;
      handleInputChange({ target: { value: "" } } as React.ChangeEvent<HTMLInputElement>);
      
      // 更新消息
      setMessages((prev) => [...prev, userMessage]);
      
      // 初始化助手消息
      const assistantMessageId = messageId + "_assistant";
      setMessages((prev) => [...prev, { id: assistantMessageId, role: "assistant", content: "" } as Message]);
      
      // 初始化流状态
      setStreamStates((prev) => ({
        ...prev,
        [assistantMessageId]: { ...initialStreamParserState }
      }));
      
      // 发送请求
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [...messages, { role: "user", content: currentInput }]
        })
      });
      
      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
      }
      
      // 处理自定义流
      await processCustomStream(response, (state) => {
        setStreamStates((prev) => ({
          ...prev,
          [assistantMessageId]: state
        }));
        
        // 更新消息内容
        setMessages((prev) => 
          prev.map((msg) => 
            msg.id === assistantMessageId 
              ? { ...msg, content: state.text } as Message
              : msg
          )
        );
      });
      
      // 完成后关闭加载状态
      setIsLoading(false);
      
    } catch (err: any) {
      setErrorMessage(err.message || "An error occurred while processing your request.");
      // 错误时也要关闭加载状态
      setIsLoading(false);
    }
  };

  const resetToHome = () => {
    handleNewChat();
    setShowHero(true);
  };

  const MessageDialog = ({ message }: { message: Message }) => (
    <div
      className="fixed inset-0 bg-black/50 dark:bg-gray-900/80 flex items-center justify-center z-50 backdrop-blur-sm"
      onClick={(e: React.MouseEvent<HTMLDivElement>) => {
        if (e.target === e.currentTarget) {
          setSelectedMessage(null);
        }
      }}
    >
      <div className="bg-white dark:bg-gray-800 p-6 rounded-lg max-w-3xl w-full mx-4 max-h-[80vh] overflow-auto shadow-xl">
        <div className="flex justify-between items-center mb-4 border-b border-gray-200 dark:border-gray-700 pb-3">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Message Details</h2>
          <button
            onClick={() => setSelectedMessage(null)}
            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div
          className="bg-gray-100 dark:bg-gray-900 p-6 rounded-lg font-mono text-sm leading-relaxed overflow-auto"
          dangerouslySetInnerHTML={{
            __html: formatJSON(message as unknown as Record<string, unknown>),
          }}
        />
      </div>
    </div>
  );

  const AboutModal = () => (
    <div 
      className="fixed inset-0 bg-black/50 dark:bg-gray-900/80 flex items-center justify-center z-50 backdrop-blur-sm"
      onClick={() => setShowAboutModal(false)}
    >
      <div 
        className="bg-white dark:bg-gray-800 p-6 rounded-lg max-w-3xl w-full mx-4 max-h-[80vh] overflow-auto shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-4 border-b border-gray-200 dark:border-gray-700 pb-3">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">About BIAN AI Assistant</h2>
          <button
            onClick={() => setShowAboutModal(false)}
            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <div className="prose dark:prose-invert max-w-none">
          <h3>Product Overview</h3>
          <p>
            AI_BIAN is an intelligent Q&A system built with Next.js 14, specifically designed to provide professional answers about the BIAN (Banking Industry Architecture Network) framework.
            The system uses RAG (Retrieval-Augmented Generation) technology combined with the Gemini Pro large language model to provide accurate and comprehensive BIAN-related knowledge.
          </p>
          
          <h3>Core Features</h3>
          <ul>
            <li><strong>Intelligent Q&A</strong>: Provides accurate answers to professional questions about the BIAN framework</li>
            <li><strong>Query Rewriting</strong>: Transforms user's natural language questions into BIAN-specific professional queries</li>
            <li><strong>Document Retrieval</strong>: Retrieves relevant document excerpts from the BIAN knowledge base</li>
            <li><strong>Comprehensive Responses</strong>: Generates complete answers by combining RAG results with Gemini's knowledge</li>
            <li><strong>Streaming Response</strong>: Displays generation process in real-time for improved user experience</li>
          </ul>
          
          <h3>Technology Stack</h3>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse my-4">
              <thead>
                <tr className="border-b border-gray-300 dark:border-gray-700">
                  <th className="p-2 text-left font-semibold">Component</th>
                  <th className="p-2 text-left font-semibold">Technology</th>
                  <th className="p-2 text-left font-semibold">Purpose</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-gray-200 dark:border-gray-800">
                  <td className="p-2">Frontend</td>
                  <td className="p-2">Next.js 14 (App Router)</td>
                  <td className="p-2">User interface and interactions</td>
                </tr>
                <tr className="border-b border-gray-200 dark:border-gray-800">
                  <td className="p-2">Deployment</td>
                  <td className="p-2">Railway</td>
                  <td className="p-2">Application hosting and scaling</td>
                </tr>
                <tr className="border-b border-gray-200 dark:border-gray-800">
                  <td className="p-2">Vector Retrieval</td>
                  <td className="p-2">Vectorize.io</td>
                  <td className="p-2">BIAN document retrieval</td>
                </tr>
                <tr className="border-b border-gray-200 dark:border-gray-800">
                  <td className="p-2">Large Language Model</td>
                  <td className="p-2">Google Gemini Pro</td>
                  <td className="p-2">Query rewriting and answer generation</td>
                </tr>
              </tbody>
            </table>
          </div>
          
          <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700 text-sm text-gray-500 dark:text-gray-400">
            <p>© 2025 BIAN AI Assistant. All rights reserved.</p>
          </div>
        </div>
      </div>
    </div>
  );

  // 渲染聊天消息
  const renderMessage = (message: any, index: number) => {
    const isUser = message.role === 'user';
    const isLast = index === messages.length - 1;
    
    // 获取此消息的流状态（如果是AI回复）
    const streamState = !isUser ? streamStates[message.id] : undefined;
    
    // 确定是否使用流加载指示器
    const showLoading = !isUser && isLast && isLoading && (!streamState || !streamState.isComplete);
    
    return (
      <div
        key={message.id}
        className={`flex prose prose-sm md:prose-base dark:prose-invert max-w-none flex-col ${isUser ? 'items-end' : 'items-start'} mb-6`}
        data-message-id={message.id}
      >
        <div className="flex items-start w-full max-w-full sm:max-w-3xl">
          <div
            className={`w-full px-4 py-3 rounded-2xl ${
              isUser
                ? 'bg-blue-500 text-white dark:bg-blue-600'
                : 'bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-100'
            } ${
              // 增加条件检查，如果是最后一条消息并且是加载中状态，则添加 "加载中" 样式
              showLoading ? 'animate-pulse' : ''
            }`}
          >
            {isUser ? (
              <div className="prose dark:prose-invert whitespace-pre-wrap break-words">{message.content}</div>
            ) : (
              <>
                {/* 使用条件渲染：在有图表时使用自定义ChatMessage组件，无图表时使用AI SDK原生Markdown渲染 */}
                {streamState && streamState.diagrams && streamState.diagrams.length > 0 ? (
                  <ChatMessage 
                    content={message.content}
                    diagrams={streamState.diagrams}
                  />
                ) : (
                  <div className="prose prose-sm md:prose-base dark:prose-invert max-w-none break-words prose-p:my-4 prose-ul:my-4 prose-ol:my-4">
                    {message.content || (showLoading ? 'Thinking...' : '')}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className={`flex flex-col min-h-screen ${darkMode ? 'dark bg-gray-900 text-white' : 'bg-gray-50 text-gray-900'}`}>
      {/* Disclaimer Banner */}
      <div className="bg-yellow-100 dark:bg-yellow-900/30 border-b border-yellow-200 dark:border-yellow-800 p-3 text-center text-xs sm:text-sm text-yellow-800 dark:text-yellow-300">
        <AlertCircle className="inline-block w-4 h-4 mr-1 mb-0.5" />
        <strong>Disclaimer:</strong> BIAN AI Assistant is a personal hobby project designed to provide educational information about the BIAN framework. It is not affiliated with BIAN or any official organization. Responses are generated by AI based on available data and may not always be accurate or complete. This tool is for informational purposes only and should not be used for critical decision-making. For official guidance, visit{' '}
        <a href="https://bian.org/" target="_blank" rel="noopener noreferrer" className="underline font-medium hover:text-yellow-600 dark:hover:text-yellow-100">
          BIAN's official website
        </a>.
      </div>

      {/* Navigation Bar */}
      <nav className="sticky top-0 z-10 backdrop-blur-md bg-white/80 dark:bg-gray-900/80 border-b border-gray-200 dark:border-gray-800 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <div className="flex-shrink-0 flex items-center">
                <button 
                  onClick={resetToHome}
                  className="flex items-center gap-2 hover:opacity-80 transition-opacity focus:outline-none"
                >
                  <div className="bg-blue-600 text-white rounded-lg flex flex-col items-center justify-center p-2 w-12 h-12">
                    <MessageSquare className="w-5 h-5 mb-0.5" strokeWidth={2} />
                    <span className="font-bold text-[0.6rem] leading-none tracking-tight">BIAN</span>
                  </div>
                  <span className="font-semibold text-xl">BIAN <span className="text-blue-600">AI</span> Assistant</span>
                </button>
              </div>
            </div>
            
            <div className="hidden md:flex items-center gap-4">
              <a href="https://bian.org" target="_blank" rel="noopener noreferrer" className="text-gray-600 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 px-3 py-2 rounded-md text-sm font-medium flex items-center gap-1 transition-colors">
                BIAN Website <ExternalLink className="w-3.5 h-3.5" />
              </a>
              
              <div className="relative" ref={resourcesDropdownRef}>
                <button 
                  onClick={() => setShowResourcesDropdown(!showResourcesDropdown)}
                  className="text-gray-600 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 px-3 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-1"
                >
                  Resources <ChevronDown className={`w-4 h-4 transition-transform ${showResourcesDropdown ? 'rotate-180' : ''}`} />
                </button>
                
                {showResourcesDropdown && (
                  <div className="absolute right-0 mt-2 w-64 bg-white dark:bg-gray-800 rounded-md shadow-lg py-1 z-20 border border-gray-200 dark:border-gray-700">
                    <a 
                      href="https://bian.org/servicelandscape-12-0-0/" 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="block px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
                    >
                      <div className="w-5 h-5 flex items-center justify-center">🗺️</div>
                      BIAN Service Landscape
                    </a>
                    <a 
                      href="https://www.vanharen.net/standards/bian-banking-architecture/#Prepare" 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="block px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
                    >
                      <div className="w-5 h-5 flex items-center justify-center">🎓</div>
                      Van Haren BIAN Certification
                    </a>
                    <a 
                      href="https://en.wikipedia.org/wiki/Bian" 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="block px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
                    >
                      <div className="w-5 h-5 flex items-center justify-center">📚</div>
                      Wikipedia - BIAN
                    </a>
                  </div>
                )}
              </div>
              
              <button 
                onClick={() => setShowAboutModal(true)}
                className="text-gray-600 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 px-3 py-2 rounded-md text-sm font-medium transition-colors"
              >
                About
              </button>
              
              <button 
                onClick={() => setDarkMode(!darkMode)}
                className="ml-4 p-2 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
                aria-label={darkMode ? "Switch to light mode" : "Switch to dark mode"}
              >
                {darkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
              </button>
            </div>
            
            <div className="flex items-center md:hidden">
              <button 
                onClick={() => setDarkMode(!darkMode)}
                className="p-2 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 mr-2"
                aria-label={darkMode ? "Switch to light mode" : "Switch to dark mode"}
              >
                {darkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
              </button>
              <button
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                className="p-2 rounded-md text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500"
              >
                {isMobileMenuOpen ? (
                  <X className="block h-6 w-6" aria-hidden="true" />
                ) : (
                  <Menu className="block h-6 w-6" aria-hidden="true" />
                )}
              </button>
            </div>
          </div>
        </div>
        
        {isMobileMenuOpen && (
          <div className="md:hidden">
            <div className="px-2 pt-2 pb-3 space-y-1 sm:px-3 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800">
              <a
                href="https://bian.org"
                target="_blank"
                rel="noopener noreferrer"
                className="block px-3 py-2 rounded-md text-base font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 hover:bg-gray-100 dark:hover:text-white dark:hover:bg-gray-800 flex items-center gap-1"
              >
                BIAN Website <ExternalLink className="w-3.5 h-3.5" />
              </a>
              
              <a 
                href="https://bian.org/servicelandscape-12-0-0/" 
                target="_blank" 
                rel="noopener noreferrer"
                className="block px-3 py-2 rounded-md text-base font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 hover:bg-gray-100 dark:hover:text-white dark:hover:bg-gray-800 flex items-center gap-2"
                onClick={() => setIsMobileMenuOpen(false)}
              >
                <div className="w-5 h-5 flex items-center justify-center">🗺️</div>
                BIAN Service Landscape
              </a>
              <a 
                href="https://www.vanharen.net/standards/bian-banking-architecture/#Prepare" 
                target="_blank" 
                rel="noopener noreferrer"
                className="block px-3 py-2 rounded-md text-base font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 hover:bg-gray-100 dark:hover:text-white dark:hover:bg-gray-800 flex items-center gap-2"
                onClick={() => setIsMobileMenuOpen(false)}
              >
                <div className="w-5 h-5 flex items-center justify-center">🎓</div>
                Van Haren BIAN Certification
              </a>
              <a 
                href="https://en.wikipedia.org/wiki/Bian" 
                target="_blank" 
                rel="noopener noreferrer"
                className="block px-3 py-2 rounded-md text-base font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 hover:bg-gray-100 dark:hover:text-white dark:hover:bg-gray-800 flex items-center gap-2"
                onClick={() => setIsMobileMenuOpen(false)}
              >
                <div className="w-5 h-5 flex items-center justify-center">📚</div>
                Wikipedia - BIAN
              </a>
              
              <button
                onClick={() => {
                  setShowAboutModal(true);
                  setIsMobileMenuOpen(false);
                }}
                className="block w-full text-left px-3 py-2 rounded-md text-base font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 hover:bg-gray-100 dark:hover:text-white dark:hover:bg-gray-800"
              >
                About
              </button>
            </div>
          </div>
        )}
      </nav>

      {/* Hero Section */}
      {showHero && (
        <div className="relative overflow-hidden bg-gradient-to-br from-blue-900 via-blue-800 to-indigo-900 dark:from-gray-900 dark:via-gray-800 dark:to-blue-900">
          <div className="absolute inset-0 bg-[url('/grid-pattern.svg')] bg-center [mask-image:linear-gradient(180deg,white,rgba(255,255,255,0))]"></div>
          <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 md:py-24">
            <div className="text-center">
              <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-extrabold tracking-tight text-white">
                <span className="block">BIAN AI Knowledge Base</span>
              </h1>
              <p className="mt-3 max-w-md mx-auto text-sm sm:text-base md:text-lg lg:text-xl md:max-w-3xl text-blue-100">
                Your intelligent assistant for Banking Industry Architecture Network standards and frameworks
              </p>
              <div className="mt-6 sm:mt-8 max-w-md mx-auto sm:max-w-lg md:max-w-3xl">
                <div className="flex flex-wrap gap-2 sm:gap-3 justify-center">
                  <div className="flex items-center gap-1.5 sm:gap-2 px-3 py-1.5 sm:px-4 sm:py-2 rounded-full bg-white/10 backdrop-blur-sm text-white border border-white/20 text-xs sm:text-sm">
                    <Zap className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                    <span>Powered by RAG + Generative AI</span>
                  </div>
                  <div className="flex items-center gap-1.5 sm:gap-2 px-3 py-1.5 sm:px-4 sm:py-2 rounded-full bg-white/10 backdrop-blur-sm text-white border border-white/20 text-xs sm:text-sm">
                    <MessageSquare className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                    <span>Natural conversation interface</span>
                  </div>
                  <div className="flex items-center gap-1.5 sm:gap-2 px-3 py-1.5 sm:px-4 sm:py-2 rounded-full bg-white/10 backdrop-blur-sm text-white border border-white/20 text-xs sm:text-sm">
                    <Map className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                    <span>Based on BIAN 12.0 Service Landscape</span>
                  </div>
                  <div className="flex items-center gap-1.5 sm:gap-2 px-3 py-1.5 sm:px-4 sm:py-2 rounded-full bg-white/10 backdrop-blur-sm text-white border border-white/20 text-xs sm:text-sm">
                    <Globe className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                    <span>Up-to-date with Web Search Augmentation</span>
                  </div>
                </div>
              </div>
              <div className="mt-6 sm:mt-8">
                <button 
                  onClick={() => {
                    setShowHero(false);
                    const inputElement = document.querySelector('input[placeholder^="Ask about BIAN"]');
                    if (inputElement instanceof HTMLElement) {
                       inputElement.focus();
                    }
                  }}
                  className="inline-flex items-center px-5 py-2.5 sm:px-6 sm:py-3 border border-transparent text-sm sm:text-base font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 md:text-lg transition-all transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                >
                  Start exploring
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <main className="flex-1 flex flex-col">
        {/* Introduction Panel - Only visible when no messages and hero is hidden */}
        {showIntroPanel && !showHero && (
          <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 shadow-sm py-6">
            <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">Welcome to BIAN AI Assistant</h2>
              <p className="text-gray-600 dark:text-gray-300 mb-4">
                Ask any question about BIAN frameworks, architecture patterns, banking service domains, or implementation strategies.
              </p>
              <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-100 dark:border-blue-800 rounded-lg p-4 mb-2">
                <div className="flex">
                  <div className="flex-shrink-0">
                    <Info className="h-5 w-5 text-blue-500 dark:text-blue-400" aria-hidden="true" />
                  </div>
                  <div className="ml-3">
                    <p className="text-sm text-blue-700 dark:text-blue-300">
                      The underlying RAG knowledge base of this assistant is trained on BIAN 12.0 Service Landscape, BIAN Book 2nd Edition, and Web Search augmentation.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Chat Section */}
        <div
          ref={messagesContainerRef}
          onScroll={handleScroll}
          className={`flex-1 overflow-y-auto w-full relative scroll-smooth ${darkMode ? 'bg-gray-900' : 'bg-gray-50'} ${showHero || messages.length === 0 ? 'py-6' : 'py-0'}`}
        >
          <div className="mx-auto w-full px-4 lg:max-w-4xl">
            {messages.map((message, index) => renderMessage(message, index))}
            
            {errorMessage && (
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 flex items-start gap-3 animate-fadeIn">
                <AlertCircle className="w-5 h-5 text-red-500 dark:text-red-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <h3 className="font-medium text-red-800 dark:text-red-300">Error</h3>
                  <p className="text-red-700 dark:text-red-200 mt-1">{errorMessage}</p>
                </div>
                <button 
                  onClick={() => setErrorMessage(null)}
                  className="text-red-500 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 transition-colors"
                >
                  <XCircle className="w-5 h-5" />
                </button>
              </div>
            )}
            
            <div ref={messagesEndRef} />
          </div>
        </div>
      </main>

      {showScrollButton && (
        <button
          onClick={scrollToBottom}
          className="fixed bottom-24 right-8 bg-blue-600 text-white p-2 rounded-full shadow-lg hover:bg-blue-700 transition-colors flex items-center gap-2 z-10 animate-bounce-subtle"
        >
          <ChevronDown className="w-5 h-5" />
          <span className="pr-2">Scroll to bottom</span>
        </button>
      )}

      <div className="border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-800 p-4 shadow-md">
        <div className="max-w-3xl mx-auto space-y-4 sm:space-y-6">
          {showPlaceholders && messages.length === 0 && (
            <div className="flex flex-wrap gap-2 sm:gap-3 mb-4 justify-center">
              {randomPlaceholders.map((option, index) => (
                <button
                  key={index}
                  onClick={() => handleOptionSelect(option)}
                  className={`flex items-center gap-1.5 sm:gap-2 px-3 py-1.5 sm:px-4 sm:py-2 rounded-full transition-all 
                    backdrop-filter backdrop-blur-sm bg-opacity-20 hover:bg-opacity-30 transform hover:scale-105
                    flex-wrap sm:flex-nowrap
                    ${
                      selectedOption === option
                        ? "bg-blue-600 text-white shadow-lg"
                        : `${darkMode ? 'bg-gray-700 text-gray-200 hover:bg-gray-600' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`
                    }`}
                  disabled={isLoading}
                >
                  <span className="flex-shrink-0">{option.emoji}</span>
                  <span className="text-xs sm:text-sm font-medium break-words">{option.text}</span>
                </button>
              ))}
            </div>
          )}

          <div className="flex gap-2">
            <form onSubmit={handleFormSubmit} className="flex gap-2 flex-1">
              <input
                value={input}
                onChange={handleInputChange}
                placeholder="Ask about BIAN standards, frameworks, or implementation..."
                className={`flex-1 px-4 py-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors
                ${darkMode 
                  ? 'bg-gray-700 text-white border border-gray-600 placeholder-gray-400' 
                  : 'bg-gray-100 text-gray-900 border border-gray-300 placeholder-gray-500'}`}
                disabled={isLoading}
              />
              <button
                type="submit"
                className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                disabled={isLoading || !input.trim()}
              >
                <Send className="w-5 h-5" />
                <span className="hidden sm:inline">Send</span>
              </button>
            </form>
            <button
              onClick={handleNewChat}
              className={`p-3 rounded-lg transition-colors flex items-center 
                ${darkMode 
                  ? 'bg-gray-700 text-gray-300 hover:bg-gray-600' 
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
              title="Start New Chat"
              disabled={isLoading}
            >
              <Trash2 className="w-5 h-5" />
            </button>
          </div>

          <div className="flex justify-center">
            <a
              href="https://vectorize.io"
              target="_blank"
              rel="noopener noreferrer"
              className="block transition-opacity hover:opacity-80"
            >
              <div className="flex items-center gap-2">
                <span className="text-gray-500 dark:text-gray-400 text-sm">Powered by</span>
                <img src={darkMode ? "/vio-light-logo.svg" : "/vio-light-logo.svg"} alt="Vectorize Logo" className="h-5" />
              </div>
            </a>
          </div>
        </div>
      </div>

      {showAboutModal && <AboutModal />}
      {selectedMessage && <MessageDialog message={selectedMessage} />}
      
      {/* Add global styles for animations */}
      <style jsx global>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        
        @keyframes bounceSoft {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-5px); }
        }
        
        .animate-fadeIn {
          animation: fadeIn 0.3s ease-out forwards;
        }
        
        .animate-bounce-subtle {
          animation: bounceSoft 2s infinite;
        }
        
        .dark {
          color-scheme: dark;
        }
      `}</style>
    </div>
  );
}