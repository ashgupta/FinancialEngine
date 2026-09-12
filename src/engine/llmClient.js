export const LLM_PROVIDERS = {
  GROQ: {
    name: 'Groq (Free)',
    url: 'https://api.groq.com/openai/v1/chat/completions',
    defaultModel: 'llama-3.3-70b-versatile',
    link: 'https://console.groq.com/keys'
  }
};

const STORAGE_KEY = 'windsurf_llm_api_key';

export function getApiKey() {
  return localStorage.getItem(STORAGE_KEY) || '';
}

export function saveApiKey(key) {
  localStorage.setItem(STORAGE_KEY, key.trim());
}

export async function chatWithLLM(messages, systemContext = '') {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('API Key is missing. Please save your API key first.');
  }

  const payload = {
    model: LLM_PROVIDERS.GROQ.defaultModel,
    messages: [
      { role: 'system', content: systemContext },
      ...messages
    ],
    temperature: 0.7,
    max_tokens: 1024,
  };

  const response = await fetch(LLM_PROVIDERS.GROQ.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`API Error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}
