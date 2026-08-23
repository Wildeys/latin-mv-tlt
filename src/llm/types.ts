export type LlmProvider = 'api' | 'ollama' | 'browser';

export type LlmSettings = {
  provider: LlmProvider;
  apiUrl: string;
  model: string;
  apiKey: string;
  remember: boolean;
};

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  thaana?: string;
  english?: string;
  pending?: boolean;
};
