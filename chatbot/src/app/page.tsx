"use client";

import { Message, useChat } from "@ai-sdk/react";
import Markdown from "react-markdown";
import { useState, useRef, useEffect } from "react";
import remarkGfm from "remark-gfm";
import { AlertCircle, ChevronDown, Trash2, RefreshCw, XCircle, Moon, Sun, Send, Menu, X, Info, ExternalLink, MessageSquare, Zap, Map, Globe } from "lucide-react";
import { retrieveDiagrams, DiagramDocument } from "../services/diagramService";
import DiagramViewer from "../components/DiagramViewer";

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
  { emoji: "🔄", text: "Explain the interaction patterns between the Customer Onboarding Service Domain and related Service Domains within the BIAN framework. Illustrate these interaction points with a diagram." },
  { emoji: "💳", text: "I need to design a BIAN-based payment processing system. Please provide a detailed structural diagram of the Payment Execution Service Domain and explain its integration approach with the Clearing and Settlement Service Domain." },
  { emoji: "📋", text: "Show a relationship diagram for the Product Directory, Product Design, and Product Pricing Service Domains within BIAN. Explain how they collaborate to support Product Lifecycle Management." },
  { emoji: "📡", text: "Explain the difference between the Request-Response and Notification patterns within BIAN Service Operations. Can you provide example diagrams illustrating these Service Domain interaction patterns?" },
  { emoji: "🔒", text: "Present the BIAN Service Domain architecture diagram related to Risk Management, specifically showing the relationships and information flows between Fraud Detection, Compliance Check, and Transaction Authorization." },
  { emoji: "🔐", text: "According to the BIAN framework, how should Digital Identity & Authentication and KYC (Know Your Customer) processes be implemented? Please provide diagrams of the involved Service Domains and typical interaction sequence diagrams." },
  { emoji: "🌍", text: "I am designing a BIAN-based Open Banking API architecture. Please provide reference diagrams illustrating how an API Gateway interacts with relevant Service Domains, particularly focusing on the implementation approach for Account Information Services (AIS) and Payment Initiation Services (PIS)." },
  { emoji: "📊", text: "Within the BIAN Service Domain decomposition model, how is the mapping relationship established between Business Scenarios and Service Domains? Can you provide a complete Service Domain constellation diagram for a Wealth Management business scenario?" },
  { emoji: "📨", text: "Illustrate the event-driven service integration pattern within the BIAN reference architecture. Use a diagram to explain how the related event handling, event publishing, and subscription mechanisms support loosely coupled communication between different Service Domains." },
  { emoji: "📱", text: "When implementing a BIAN architecture, what integration patterns should be followed for integrating the Core Banking System with Digital Channels? Please provide an integration reference diagram for the Channel Management, Customer Interaction, and Product Servicing Service Domains, explaining the boundaries and responsibility allocation between them." },
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
  const { messages, setMessages, input, handleInputChange, handleSubmit, isLoading, error, append } = useChat({
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
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return false;
  });
  const [showHero, setShowHero] = useState(true);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [showIntroPanel, setShowIntroPanel] = useState(true);
  const [showResourcesDropdown, setShowResourcesDropdown] = useState(false);
  const [showAboutModal, setShowAboutModal] = useState(false);
  const [diagramsByMessageId, setDiagramsByMessageId] = useState<Record<string, DiagramDocument[]>>({});
  
  const resourcesDropdownRef = useRef<HTMLDivElement>(null);

  // Toggle dark mode
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

  // Listen for system color scheme changes
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (e: MediaQueryListEvent) => {
      setDarkMode(e.matches);
    };
    
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

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
      await append({
        role: "user",
        content: option.text,
      });
    } catch (err: any) {
      console.error("Error sending placeholder message:", err);
      setErrorMessage(err.message || "An error occurred while processing your request.");
    }
  };

  const handleFormSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    setErrorMessage(null);
    if (input.trim()) {
      setShowHero(false);
      setShowIntroPanel(false);
    }
    try {
      await handleSubmit(event);
    } catch (err: any) {
      setErrorMessage(err.message || "An error occurred while processing your request.");
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

  return (
    <div className={`flex flex-col min-h-screen ${darkMode ? 'dark bg-gray-900 text-white' : 'bg-gray-50 text-gray-900'}`}>
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
          <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 md:py-24">
            <div className="text-center">
              <h1 className="text-4xl sm:text-5xl md:text-6xl font-extrabold tracking-tight text-white">
                <span className="block">BIAN AI Knowledge Base</span>
              </h1>
              <p className="mt-3 max-w-md mx-auto text-base sm:text-lg md:text-xl md:max-w-3xl text-blue-100">
                Your intelligent assistant for Banking Industry Architecture Network standards and frameworks
              </p>
              <div className="mt-8 max-w-md mx-auto sm:max-w-lg md:max-w-3xl">
                <div className="flex flex-wrap gap-3 justify-center">
                  <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 backdrop-blur-sm text-white border border-white/20">
                    <Zap className="w-4 h-4" />
                    <span>Powered by RAG + Generative AI</span>
                  </div>
                  <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 backdrop-blur-sm text-white border border-white/20">
                    <MessageSquare className="w-4 h-4" />
                    <span>Natural conversation interface</span>
                  </div>
                  <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 backdrop-blur-sm text-white border border-white/20">
                    <Map className="w-4 h-4" />
                    <span>Based on BIAN 12.0 Service Landscape</span>
                  </div>
                  <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 backdrop-blur-sm text-white border border-white/20">
                    <Globe className="w-4 h-4" />
                    <span>Up-to-date with Web Search Augmentation</span>
                  </div>
                </div>
              </div>
              <div className="mt-8">
                <button 
                  onClick={() => {
                    setShowHero(false);
                    messagesContainerRef.current?.focus();
                  }}
                  className="inline-flex items-center px-6 py-3 border border-transparent text-base font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 md:text-lg transition-all transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
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
          className={`flex-1 overflow-y-auto relative scroll-smooth ${darkMode ? 'bg-gray-900' : 'bg-gray-50'} ${showHero || messages.length === 0 ? 'py-6' : 'py-0'}`}
        >
          <div className="max-w-3xl mx-auto space-y-6 p-4">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex gap-4 p-5 rounded-lg shadow-sm transition-all duration-200 animate-fadeIn
                  ${message.role === "user" 
                    ? "bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-900/50" 
                    : "bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700"}`}
              >
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0
                    ${message.role === "user" 
                      ? "bg-blue-500 text-white" 
                      : "bg-indigo-500 text-white"}`}
                >
                  {message.role === "user" ? "👤" : "🤖"}
                </div>
                <div className="flex-1 min-w-0 overflow-hidden">
                  <div className="prose prose-blue dark:prose-invert max-w-none">
                    <div
                      className={`[&>table]:w-full [&>table]:border-collapse [&>table]:my-4 [&>table>thead>tr]:border-b [&>table>thead>tr]:border-gray-300 dark:[&>table>thead>tr]:border-gray-700 [&>table>tbody>tr]:border-b [&>table>tbody>tr]:border-gray-200 dark:[&>table>tbody>tr]:border-gray-800 [&>table>*>tr>*]:p-2 [&>table>*>tr>*]:text-left [&>table>thead>tr>*]:font-semibold [&>table>tbody>tr>*]:align-top`}
                    >
                      <Markdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          a: ({ href, children }) => {
                            const isFootnoteRef = /^\d+$/.test(children?.[0]?.toString());
                            if (isFootnoteRef) {
                              return (
                                <a href={href} className="text-blue-600 dark:text-blue-400 hover:underline">
                                  {children}
                                </a>
                              );
                            }
                            return (
                              <a
                                href={href}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 after:content-['_↗'] after:text-xs after:opacity-70"
                              >
                                {children}
                              </a>
                            );
                          },
                          code: ({ children }) => {
                            return (
                              <code className="bg-gray-100 dark:bg-gray-800 rounded px-1 py-0.5 text-sm font-mono text-blue-700 dark:text-blue-300">
                                {children}
                              </code>
                            );
                          },
                          blockquote: ({ children }) => {
                            return (
                              <blockquote className="border-l-4 border-blue-500 dark:border-blue-600 pl-4 italic text-gray-700 dark:text-gray-300">
                                {children}
                              </blockquote>
                            );
                          },
                        }}
                      >
                        {message.content}
                      </Markdown>
                    </div>
                  </div>
                  {/* Diagram Display Area - Placed below the main message content */}
                  {diagramsByMessageId[message.id] && diagramsByMessageId[message.id].length > 0 && (
                    <div className="mt-4 border-t border-gray-200 dark:border-gray-700 pt-4">
                      <h4 className="text-sm font-semibold mb-2 text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
                        <Map className="w-4 h-4" /> 
                        Related Diagrams:
                      </h4>
                      <div className="space-y-3">
                        {diagramsByMessageId[message.id].map((diagram, index) => (
                          <DiagramViewer
                            key={`${message.id}-diag-${index}`} // Unique key for each diagram
                            svgContent={diagram.svg_content}
                            title={diagram.source_display_name || `Diagram ${index + 1}`} // Provide fallback title
                            sourceUrl={diagram.source_url}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                  {/* End Diagram Display Area */}
                  <button
                    onClick={() => setSelectedMessage(message)}
                    className="mt-3 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors flex items-center gap-1"
                  >
                    <Info className="w-3.5 h-3.5" />
                    View Details
                  </button>
                </div>
              </div>
            ))}
            
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
            
            {isLoading && !errorMessage && (
              <div className="flex justify-center items-center py-4 animate-fadeIn">
                <div className="relative">
                  <div className="animate-ping absolute h-8 w-8 rounded-full bg-blue-400 opacity-75"></div>
                  <div className="animate-spin relative rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                </div>
                <span className="ml-3 text-gray-600 dark:text-gray-300">Processing your request...</span>
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
        <div className="max-w-3xl mx-auto space-y-6">
          {showPlaceholders && messages.length === 0 && (
            <div className="flex flex-wrap gap-3 mb-4 justify-center">
              {randomPlaceholders.map((option, index) => (
                <button
                  key={index}
                  onClick={() => handleOptionSelect(option)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-full transition-all whitespace-nowrap
                    backdrop-filter backdrop-blur-sm bg-opacity-20 hover:bg-opacity-30 transform hover:scale-105
                    ${
                      selectedOption === option
                        ? "bg-blue-600 text-white shadow-lg"
                        : `${darkMode ? 'bg-gray-700 text-gray-200 hover:bg-gray-600' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`
                    }`}
                  disabled={isLoading}
                >
                  <span>{option.emoji}</span>
                  <span className="text-sm font-medium">{option.text}</span>
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