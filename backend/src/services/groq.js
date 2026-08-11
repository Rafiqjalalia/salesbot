const { env } = require('../config/env');

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

function hasKey() {
  return Boolean(env.groqApiKey);
}

async function chat(messages, { model = env.groqModel, temperature = 0.7, json = false } = {}) {
  const body = {
    model,
    messages,
    temperature,
  };
  if (json) body.response_format = { type: 'json_object' };

  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.groqApiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Groq API ${res.status}: ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

module.exports = { chat, hasKey };
