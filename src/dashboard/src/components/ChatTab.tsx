import React, { useState, useRef, useEffect } from 'react';
import { User, McpTool } from '../types';
import { getToken } from '../api';
import { 
  MessageSquare, Send, Sparkles, Bot, User as UserIcon, 
  Code, AlertCircle, ChevronDown, ChevronRight, CheckCircle2, 
  Clock, RefreshCw, Terminal
} from 'lucide-react';

interface ToolCallState {
  tool: string;
  args?: any;
  result?: any;
  isError?: boolean;
}

interface MessageItem {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  thought?: string;
  toolCalls?: ToolCallState[];
  isStreaming?: boolean;
}

interface ChatTabProps {
  user: User;
  tools: McpTool[];
}

export const ChatTab: React.FC<ChatTabProps> = ({ user, tools }) => {
  const [messages, setMessages] = useState<MessageItem[]>([
    {
      id: 'welcome',
      role: 'assistant',
      text: `Hello ${user.email}! I am the UAI Assistant, running on Kubernetes with real-time access to ${tools.length} live MCP tools. Ask me to manage your WooCommerce store, query orders, or run utility calculations.`,
    },
  ]);
  const [input, setInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [expandedTools, setExpandedTools] = useState<Record<string, boolean>>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const samplePrompts = [
    "create a product Premium Wireless Headphones at 499",
    "what orders came in today",
    "get today's orders, then convert the total to EUR",
    "echo Hello from the autonomous agent",
  ];

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const toggleToolExpand = (toolKey: string) => {
    setExpandedTools((prev) => ({ ...prev, [toolKey]: !prev[toolKey] }));
  };

  const handleSend = async (textToSend?: string) => {
    const text = (textToSend || input).trim();
    if (!text || isGenerating) return;

    const userMsgId = `user_${Date.now()}`;
    const assistantMsgId = `assistant_${Date.now()}`;

    // Append user message and empty streaming assistant message
    setMessages((prev) => [
      ...prev,
      { id: userMsgId, role: 'user', text },
      { id: assistantMsgId, role: 'assistant', text: '', isStreaming: true, toolCalls: [] },
    ]);
    setInput('');
    setIsGenerating(true);

    try {
      const token = getToken();
      const history = messages
        .filter((m) => m.id !== 'welcome')
        .map((m) => ({ role: m.role, content: m.text }));

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: 'include',
        body: JSON.stringify({ message: text, history }),
      });

      if (!res.ok) {
        throw new Error(`Chat error (${res.status}): ${await res.text()}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error('ReadableStream not supported.');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) continue;
          const jsonStr = trimmed.substring(6).trim();
          if (!jsonStr) continue;

          try {
            const event = JSON.parse(jsonStr);

            setMessages((prev) =>
              prev.map((msg) => {
                if (msg.id !== assistantMsgId) return msg;

                if (event.type === 'thought') {
                  return { ...msg, thought: event.content };
                }

                if (event.type === 'tool_call_start') {
                  const existingCalls = msg.toolCalls || [];
                  return {
                    ...msg,
                    toolCalls: [
                      ...existingCalls,
                      { tool: event.tool, args: event.args },
                    ],
                  };
                }

                if (event.type === 'tool_call_end') {
                  const updatedCalls = (msg.toolCalls || []).map((tc) => {
                    if (tc.tool === event.tool && !tc.result) {
                      return { ...tc, result: event.result, isError: event.isError };
                    }
                    return tc;
                  });
                  return { ...msg, toolCalls: updatedCalls };
                }

                if (event.type === 'delta') {
                  return { ...msg, text: event.content || msg.text, thought: undefined };
                }

                if (event.type === 'done') {
                  return { ...msg, text: event.content || msg.text, isStreaming: false, thought: undefined };
                }

                if (event.type === 'error') {
                  return {
                    ...msg,
                    text: `Error: ${event.content}`,
                    isStreaming: false,
                    thought: undefined,
                  };
                }

                return msg;
              })
            );
          } catch {
            // Ignore partial SSE JSON chunks
          }
        }
      }
    } catch (err: any) {
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantMsgId
            ? { ...msg, text: `Failed to stream response: ${err.message}`, isStreaming: false, thought: undefined }
            : msg
        )
      );
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center">
          <MessageSquare className="w-6 h-6 mr-2 text-indigo-600" />
          Autonomous Chat Agent
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Chat with the AI assistant. It dynamically plans, invokes tools via the UAI Gateway, and attributes actions to your identity.
        </p>
      </div>

      {/* Chat Container */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col h-[650px] overflow-hidden">
        {/* Messages Stream */}
        <div className="flex-1 p-6 overflow-y-auto space-y-6 bg-slate-50/50">
          {messages.map((m) => (
            <div
              key={m.id}
              className={`flex items-start space-x-3 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              {m.role !== 'user' && (
                <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center text-white flex-shrink-0 shadow-sm">
                  <Bot className="w-5 h-5" />
                </div>
              )}

              <div className={`max-w-2xl flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
                {/* User Message */}
                {m.role === 'user' ? (
                  <div className="rounded-2xl rounded-tr-none px-4 py-3 bg-indigo-600 text-white text-sm shadow-xs">
                    <p className="whitespace-pre-wrap">{m.text}</p>
                  </div>
                ) : (
                  /* Assistant Message */
                  <div className="w-full space-y-3">
                    {/* Live Thinking Status */}
                    {m.thought && (
                      <div className="inline-flex items-center space-x-2 text-xs font-medium text-indigo-700 bg-indigo-50 border border-indigo-100 px-3 py-1.5 rounded-full animate-pulse">
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>{m.thought}</span>
                      </div>
                    )}

                    {/* Tool Calls Display */}
                    {m.toolCalls && m.toolCalls.length > 0 && (
                      <div className="space-y-2 w-full">
                        {m.toolCalls.map((tc, idx) => {
                          const toolKey = `${m.id}_${tc.tool}_${idx}`;
                          const isExpanded = expandedTools[toolKey];
                          return (
                            <div
                              key={toolKey}
                              className="rounded-xl border border-slate-200 bg-white overflow-hidden text-xs shadow-xs"
                            >
                              <div
                                onClick={() => toggleToolExpand(toolKey)}
                                className="px-3.5 py-2.5 bg-slate-50 flex items-center justify-between cursor-pointer hover:bg-slate-100/70 transition-colors"
                              >
                                <div className="flex items-center space-x-2">
                                  <Code className="w-3.5 h-3.5 text-indigo-600" />
                                  <span className="font-mono font-bold text-slate-800">{tc.tool}</span>
                                  {tc.result ? (
                                    <span className="inline-flex items-center text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                                      <CheckCircle2 className="w-3 h-3 mr-1" /> Executed
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center text-[10px] font-semibold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-full border border-indigo-200 animate-pulse">
                                      <Clock className="w-3 h-3 mr-1" /> Invoking...
                                    </span>
                                  )}
                                </div>
                                <div className="text-slate-400">
                                  {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                                </div>
                              </div>

                              {isExpanded && (
                                <div className="p-3 border-t border-slate-100 space-y-2 bg-slate-900 text-slate-100 font-mono text-[11px] overflow-x-auto">
                                  <div>
                                    <span className="text-slate-400 font-bold block mb-1">Arguments:</span>
                                    <pre className="text-emerald-400 whitespace-pre-wrap">
                                      {JSON.stringify(tc.args, null, 2)}
                                    </pre>
                                  </div>
                                  {tc.result && (
                                    <div className="pt-2 border-t border-slate-800">
                                      <span className="text-slate-400 font-bold block mb-1">Response:</span>
                                      <pre className="text-slate-200 whitespace-pre-wrap max-h-40 overflow-y-auto">
                                        {typeof tc.result === 'string' ? tc.result : JSON.stringify(tc.result, null, 2)}
                                      </pre>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Final Answer Text */}
                    {m.text && (
                      <div className="rounded-2xl rounded-tl-none px-4 py-3 bg-white border border-slate-200 text-slate-800 text-sm shadow-xs space-y-2">
                        <div className="whitespace-pre-wrap leading-relaxed">{m.text}</div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {m.role === 'user' && (
                <div className="w-9 h-9 rounded-xl bg-slate-800 flex items-center justify-center text-white flex-shrink-0 shadow-sm">
                  <UserIcon className="w-5 h-5" />
                </div>
              )}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Suggestion Chips */}
        <div className="px-6 py-2.5 bg-white border-t border-slate-100 flex items-center space-x-2 overflow-x-auto text-xs">
          <span className="text-slate-400 flex items-center flex-shrink-0 font-medium">
            <Sparkles className="w-3.5 h-3.5 mr-1 text-amber-500" /> Suggestions:
          </span>
          {samplePrompts.map((p, idx) => (
            <button
              key={idx}
              onClick={() => handleSend(p)}
              disabled={isGenerating}
              className="px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-full whitespace-nowrap transition-colors disabled:opacity-50"
            >
              {p}
            </button>
          ))}
        </div>

        {/* Input Bar */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSend();
          }}
          className="p-4 bg-white border-t border-slate-200 flex items-center space-x-3"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={isGenerating}
            placeholder="Ask something or command a tool (e.g. 'create a product X at 499')..."
            className="flex-1 px-4 py-2.5 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-600 focus:border-indigo-600 disabled:bg-slate-50"
          />
          <button
            type="submit"
            disabled={isGenerating || !input.trim()}
            className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-medium flex items-center space-x-2 transition-colors shadow-sm disabled:opacity-50"
          >
            {isGenerating ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <>
                <span>Send</span>
                <Send className="w-4 h-4" />
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
};
