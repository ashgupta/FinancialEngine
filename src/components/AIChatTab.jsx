import React, { useState, useEffect, useRef, useCallback } from 'react';
import { getApiKey, saveApiKey, chatWithLLM, LLM_PROVIDERS } from '../engine/llmClient';
import { buildMarketContext, getAvailableDataSources } from '../engine/briefingContext';
import { useWatchlist } from '../contexts/WatchlistContext';
import {
  Settings, Send, Bot, User, RefreshCw, AlertCircle, ExternalLink,
  TrendingUp, TrendingDown, BarChart3, Activity, Layers, Gauge,
  Newspaper, Zap, Globe, Check, ChevronDown, ChevronUp, Database,
  Radar, Target,
} from 'lucide-react';
import WeeklyTrendView from './WeeklyTrendView';

const SUGGESTED_QUESTIONS = [
  { icon: TrendingUp, text: 'What is the current market momentum telling us?', category: 'Momentum' },
  { icon: Layers, text: 'Which sectors are leading and what is the rotation signal?', category: 'Sector Rotation' },
  { icon: Gauge, text: 'What does the VIX and volatility analysis suggest?', category: 'Volatility' },
  { icon: BarChart3, text: 'Summarize the latest COT report positioning', category: 'COT Report' },
  { icon: Activity, text: 'How are my watchlist stocks performing today?', category: 'Watchlist' },
  { icon: Globe, text: 'Give me a global market overview across all regions', category: 'World Markets' },
  { icon: Newspaper, text: 'What is the social sentiment around my watchlist?', category: 'Social Sentiment' },
  { icon: Zap, text: 'Are there any volume spikes or breakout signals?', category: 'Momentum' },
  { icon: Radar, text: 'What is the current crash risk score and which factors are elevated?', category: 'Crash Risk' },
  { icon: Radar, text: 'Is live data confirming Cem Karsan\'s post-midterm drawdown thesis, and which hedge structure fits best?', category: 'Crash Risk' },
  { icon: Target, text: 'What options opportunities look best across short-term and LEAPS?', category: 'Options' },
  { icon: TrendingDown, text: 'What are the biggest risks in the current market?', category: 'Volatility' },
  { icon: Database, text: 'What data sources do you have access to?', category: 'All' },
];

const DATA_SOURCE_ICONS = {
  'Global Indices': Globe,
  'Watchlist': Activity,
  'Futures': TrendingUp,
  'World Markets': Globe,
  'COT Report': BarChart3,
  'COT History': BarChart3,
  'Momentum': TrendingUp,
  'Sector Rotation': Layers,
  'Volatility': Gauge,
  'Crash Risk': Radar,
  'Social Sentiment': Newspaper,
};

function renderMarkdown(text) {
  return text.split('\n').map((line, i) => {
    if (line.trim() === '') return <div key={i} className="h-2" />;
    if (line.startsWith('### '))
      return <h4 key={i} className="font-bold text-sm text-white mt-2 mb-1">{line.slice(4)}</h4>;
    if (line.startsWith('## '))
      return <h3 key={i} className="font-bold text-base text-white mt-3 mb-1">{line.slice(3)}</h3>;
    if (line.startsWith('# '))
      return <h2 key={i} className="font-bold text-lg text-white mt-3 mb-2">{line.slice(2)}</h2>;
    if (line.startsWith('- ') || line.startsWith('* ')) {
      return (
        <div key={i} className="flex gap-2 ml-2 mb-0.5">
          <span className="text-blue-400 mt-0.5">•</span>
          <span>{formatInline(line.slice(2))}</span>
        </div>
      );
    }
    if (/^\d+\.\s/.test(line)) {
      const match = line.match(/^(\d+)\.\s(.*)/);
      return (
        <div key={i} className="flex gap-2 ml-2 mb-0.5">
          <span className="text-blue-400 font-mono text-xs mt-0.5">{match[1]}.</span>
          <span>{formatInline(match[2])}</span>
        </div>
      );
    }
    if (line.startsWith('> '))
      return <blockquote key={i} className="border-l-2 border-blue-500/40 pl-3 text-gray-400 italic my-1">{line.slice(2)}</blockquote>;
    return <p key={i} className="mb-1">{formatInline(line)}</p>;
  });
}

function formatInline(text) {
  const parts = [];
  let remaining = text;
  let key = 0;
  while (remaining.length > 0) {
    let boldMatch = remaining.match(/\*\*(.+?)\*\*/);
    let codeMatch = remaining.match(/`(.+?)`/);
    let nextMatch = null;
    let nextType = null;
    if (boldMatch && (!codeMatch || boldMatch.index < codeMatch.index)) {
      nextMatch = boldMatch;
      nextType = 'bold';
    } else if (codeMatch) {
      nextMatch = codeMatch;
      nextType = 'code';
    }
    if (!nextMatch) {
      parts.push(<span key={key++}>{remaining}</span>);
      break;
    }
    if (nextMatch.index > 0) {
      parts.push(<span key={key++}>{remaining.slice(0, nextMatch.index)}</span>);
    }
    if (nextType === 'bold') {
      parts.push(<strong key={key++} className="font-semibold text-white">{nextMatch[1]}</strong>);
    } else {
      parts.push(<code key={key++} className="bg-gray-700/50 rounded px-1 py-0.5 text-xs font-mono text-blue-300">{nextMatch[1]}</code>);
    }
    remaining = remaining.slice(nextMatch.index + nextMatch[0].length);
  }
  return parts;
}

export default function AIChatTab() {
  const { watchlist } = useWatchlist();
  const [apiKey, setApiKeyState] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [contextStatus, setContextStatus] = useState('idle');
  const [systemContext, setSystemContext] = useState('');
  const [activeSources, setActiveSources] = useState([]);
  const [showSources, setShowSources] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(true);

  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    const key = getApiKey();
    if (key) {
      setApiKeyState(key);
    } else {
      setShowSettings(true);
    }
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSaveKey = () => {
    saveApiKey(apiKey);
    setShowSettings(false);
  };

  const handleRefreshContext = useCallback(async () => {
    setContextStatus('loading');
    try {
      const symbols = watchlist.map(w => w.symbol);
      const ctx = await buildMarketContext(symbols);
      setSystemContext(ctx);
      setContextStatus('ready');
      const allSources = getAvailableDataSources();
      const found = allSources.filter(s => ctx.includes(`--- ${s.toUpperCase()}`) || ctx.includes(s));
      setActiveSources(found.length > 0 ? found : allSources);
    } catch (err) {
      console.error(err);
      setContextStatus('error');
    }
  }, [watchlist]);

  useEffect(() => {
    if (apiKey) {
      handleRefreshContext();
    }
  }, [apiKey, handleRefreshContext]);

  const handleSend = async (overrideInput) => {
    const text = (overrideInput ?? input).trim();
    if (!text || !apiKey) return;

    const userMsg = { role: 'user', content: text };
    const newMessages = [...messages, userMsg];

    setMessages(newMessages);
    setInput('');
    setShowSuggestions(false);
    setIsLoading(true);

    try {
      const apiMessages = newMessages.map(m => ({ role: m.role, content: m.content }));
      const responseText = await chatWithLLM(apiMessages, systemContext);
      setMessages([...newMessages, { role: 'assistant', content: responseText }]);
    } catch (err) {
      setMessages([...newMessages, { role: 'assistant', content: `**Error:** ${err.message}` }]);
    } finally {
      setIsLoading(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSuggestion = (q) => {
    setInput(q);
    handleSend(q);
  };

  const handleClearChat = () => {
    setMessages([]);
    setShowSuggestions(true);
  };

  return (
    <div className="space-y-4">
      <div className="h-[calc(100vh-80px)] flex flex-col max-w-5xl mx-auto p-4 gap-3">
        {/* Header */}
        <div className="flex justify-between items-center bg-gray-900 p-4 rounded-xl border border-gray-800">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-500/20 rounded-lg">
              <Bot className="w-6 h-6 text-blue-400" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">Market Assistant</h2>
              <div className="flex items-center gap-2 text-sm text-gray-400">
                <span>Powered by Groq & LLaMA</span>
                <span>•</span>
                <button
                  onClick={handleRefreshContext}
                  disabled={contextStatus === 'loading'}
                  className="flex items-center gap-1 hover:text-white transition-colors disabled:opacity-50"
                >
                  <RefreshCw className={`w-3 h-3 ${contextStatus === 'loading' ? 'animate-spin' : ''}`} />
                  {contextStatus === 'loading' ? 'Syncing all data...' : contextStatus === 'ready' ? `${activeSources.length} data sources synced` : 'Click to sync data'}
                </button>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {messages.length > 0 && (
              <button
                onClick={handleClearChat}
                className="px-3 py-1.5 text-xs text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors"
              >
                Clear Chat
              </button>
            )}
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
            >
              <Settings className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Data Sources Bar */}
        {contextStatus === 'ready' && activeSources.length > 0 && (
          <div className="bg-gray-900/60 border border-gray-800 rounded-xl px-4 py-2">
            <button
              onClick={() => setShowSources(!showSources)}
              className="flex items-center gap-2 w-full text-xs text-gray-400 hover:text-white transition-colors"
            >
              <Database className="w-3.5 h-3.5 text-blue-400" />
              <span className="font-medium">{activeSources.length} data sources active</span>
              {showSources ? <ChevronUp className="w-3.5 h-3.5 ml-auto" /> : <ChevronDown className="w-3.5 h-3.5 ml-auto" />}
            </button>
            {showSources && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {activeSources.map(src => {
                  const Icon = DATA_SOURCE_ICONS[src] || Database;
                  return (
                    <span key={src} className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-blue-500/10 text-blue-300 text-[11px] border border-blue-500/20">
                      <Icon className="w-3 h-3" />
                      {src}
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Settings Panel */}
        {showSettings && (
          <div className="bg-gray-900 border border-gray-800 p-6 rounded-xl space-y-4">
            <div className="flex items-start gap-3 text-blue-400 bg-blue-500/10 p-4 rounded-lg">
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">API Key Required</p>
                <p className="text-sm mt-1 text-blue-300">
                  To use the AI assistant for free, you need a Groq API key. Groq provides ultra-fast, free access to Meta's LLaMA model.
                </p>
                <a
                  href={LLM_PROVIDERS.GROQ.link}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 mt-2 text-sm font-semibold hover:underline"
                >
                  Get your free key here <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-400 mb-2">Groq API Key</label>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKeyState(e.target.value)}
                  placeholder="gsk_..."
                  className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-blue-500"
                />
                <button
                  onClick={handleSaveKey}
                  disabled={!apiKey.trim()}
                  className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg font-medium transition-colors"
                >
                  Save
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-2">
                Your key is stored locally in your browser and is never sent to our servers.
              </p>
            </div>
          </div>
        )}

        {/* Chat Area */}
        <div className="flex-1 bg-gray-900 border border-gray-800 rounded-xl overflow-hidden flex flex-col">
          {messages.length === 0 && showSuggestions ? (
            <div className="flex-1 overflow-y-auto p-6">
              <div className="flex flex-col items-center text-center mb-6 pt-4">
                <div className="p-3 bg-blue-500/10 rounded-2xl mb-3">
                  <Bot className="w-12 h-12 text-blue-400" />
                </div>
                <h3 className="text-xl font-semibold text-gray-200 mb-1">Ask me anything about your market data</h3>
                <p className="text-sm text-gray-500 max-w-lg">
                  I have access to {activeSources.length || 'all'} data sources including indices, futures, COT reports,
                  momentum scans, sector rotation, volatility, social sentiment, and your watchlist.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-w-3xl mx-auto">
                {SUGGESTED_QUESTIONS.map((q, i) => {
                  const Icon = q.icon;
                  return (
                    <button
                      key={i}
                      onClick={() => handleSuggestion(q.text)}
                      disabled={!apiKey || isLoading}
                      className="flex items-start gap-3 p-3 bg-gray-800/60 hover:bg-gray-800 border border-gray-700/50 hover:border-blue-500/30 rounded-xl text-left transition-all disabled:opacity-40 group"
                    >
                      <div className="p-1.5 bg-blue-500/10 rounded-lg group-hover:bg-blue-500/20 transition-colors shrink-0">
                        <Icon className="w-4 h-4 text-blue-400" />
                      </div>
                      <div>
                        <p className="text-sm text-gray-300 group-hover:text-white transition-colors">{q.text}</p>
                        <p className="text-[10px] text-gray-600 mt-0.5">{q.category}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto p-4 space-y-6">
              {messages.map((msg, idx) => (
                <div key={idx} className={`flex gap-4 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                    msg.role === 'user' ? 'bg-blue-600' : 'bg-gradient-to-br from-blue-500 to-purple-600'
                  }`}>
                    {msg.role === 'user' ? <User className="w-5 h-5 text-white" /> : <Bot className="w-5 h-5 text-white" />}
                  </div>
                  <div className={`max-w-[80%] rounded-2xl px-5 py-3 ${
                    msg.role === 'user'
                      ? 'bg-blue-600 text-white rounded-tr-sm'
                      : 'bg-gray-800 text-gray-200 border border-gray-700 rounded-tl-sm'
                  }`}>
                    {msg.role === 'assistant' ? renderMarkdown(msg.content) : (
                      msg.content.split('\n').map((line, i) => (
                        <p key={i} className={line.trim() === '' ? 'h-2' : 'mb-1'}>{line}</p>
                      ))
                    )}
                  </div>
                </div>
              ))}
              {isLoading && (
                <div className="flex gap-4">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shrink-0">
                    <Bot className="w-5 h-5 text-white" />
                  </div>
                  <div className="bg-gray-800 border border-gray-700 rounded-2xl rounded-tl-sm px-5 py-4 flex items-center gap-2">
                    <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}

          {/* Input Area */}
          <div className="p-4 bg-gray-800/50 border-t border-gray-800">
            <div className="flex gap-2 relative">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={apiKey ? "Ask about markets, momentum, COT, sectors, volatility, futures, your watchlist..." : "Please configure your API key first..."}
                disabled={!apiKey || isLoading}
                className="flex-1 bg-gray-900 border border-gray-700 rounded-xl pl-4 pr-12 py-3 text-white focus:outline-none focus:border-blue-500 disabled:opacity-50 resize-none min-h-[52px] max-h-32"
                rows={1}
              />
              <button
                onClick={() => handleSend()}
                disabled={!input.trim() || !apiKey || isLoading}
                className="absolute right-2 top-2 bottom-2 aspect-square flex items-center justify-center bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:hover:bg-blue-600 text-white rounded-lg transition-colors"
              >
                <Send className="w-5 h-5" />
              </button>
            </div>
            <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
              <span>AI can make mistakes. Verify important data independently.</span>
              <span className="flex items-center gap-1">
                {contextStatus === 'ready' ? (
                  <><Check className="w-3 h-3 text-green-400" /> Data synced</>
                ) : contextStatus === 'loading' ? (
                  <><RefreshCw className="w-3 h-3 animate-spin" /> Syncing...</>
                ) : contextStatus === 'error' ? (
                  <><AlertCircle className="w-3 h-3 text-red-400" /> Sync failed</>
                ) : (
                  'Not synced'
                )}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 12-Week Trend View */}
      <WeeklyTrendView symbol="SPY" title="SPY — 12-Week Market Context Trend" />
    </div>
  );
}
