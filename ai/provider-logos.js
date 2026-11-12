// Public immutable asset ABI. No requests, credential fields or theme mutation.
(() => {
  'use strict';
  const logos = Object.assign(Object.create(null), {
  "ai-gateway": {
    "light": "/assets/ai/ai-gateway.png",
    "dark": "/assets/ai/ai-gateway.png"
  },
  "anthropic": {
    "light": "/assets/ai/anthropic.png",
    "dark": "/assets/ai/anthropic.png"
  },
  "copilot": {
    "light": "/assets/ai/copilot-light.svg",
    "dark": "/assets/ai/copilot-dark.svg"
  },
  "deepseek": {
    "light": "/assets/ai/deepseek.png",
    "dark": "/assets/ai/deepseek.png"
  },
  "fireworks": {
    "light": "/assets/ai/fireworks.png",
    "dark": "/assets/ai/fireworks.png"
  },
  "gemini": {
    "light": "/assets/ai/gemini.png",
    "dark": "/assets/ai/gemini.png"
  },
  "huggingface": {
    "light": "/assets/ai/huggingface.png",
    "dark": "/assets/ai/huggingface.png"
  },
  "kilocode": {
    "light": "/assets/ai/kilocode.png",
    "dark": "/assets/ai/kilocode.png"
  },
  "kimi": {
    "light": "/assets/ai/kimi-light.svg",
    "dark": "/assets/ai/kimi-dark.svg"
  },
  "meta": {
    "light": "/assets/ai/meta.png",
    "dark": "/assets/ai/meta.png"
  },
  "minimax": {
    "light": "/assets/ai/minimax.png",
    "dark": "/assets/ai/minimax.png"
  },
  "mistral": {
    "light": "/assets/ai/mistral.png",
    "dark": "/assets/ai/mistral.png"
  },
  "novita": {
    "light": "/assets/ai/novita.png",
    "dark": "/assets/ai/novita.png"
  },
  "nvidia": {
    "light": "/assets/ai/nvidia.png",
    "dark": "/assets/ai/nvidia.png"
  },
  "ollama-cloud": {
    "light": "/assets/ai/ollama-cloud.png",
    "dark": "/assets/ai/ollama-cloud.png"
  },
  "openai": {
    "light": "/assets/ai/openai-light.svg",
    "dark": "/assets/ai/openai-dark.svg"
  },
  "openrouter": {
    "light": "/assets/ai/openrouter-light.svg",
    "dark": "/assets/ai/openrouter-dark.svg"
  },
  "qwen": {
    "light": "/assets/ai/qwen.png",
    "dark": "/assets/ai/qwen.png"
  },
  "sidekick": {
    "light": "/assets/ai/sidekick-light.svg",
    "dark": "/assets/ai/sidekick-dark.svg"
  },
  "stepfun": {
    "light": "/assets/ai/stepfun.png",
    "dark": "/assets/ai/stepfun.png"
  },
  "tencent-tokenhub": {
    "light": "/assets/ai/tencent-tokenhub.png",
    "dark": "/assets/ai/tencent-tokenhub.png"
  },
  "xai": {
    "light": "/assets/ai/xai-light.svg",
    "dark": "/assets/ai/xai-dark.svg"
  },
  "xiaomi": {
    "light": "/assets/ai/xiaomi.png",
    "dark": "/assets/ai/xiaomi.png"
  },
  "zai": {
    "light": "/assets/ai/zai.png",
    "dark": "/assets/ai/zai.png"
  }
});
  for (const entry of Object.values(logos)) Object.freeze(entry);
  Object.defineProperty(window, 'SidekickProviderLogos', { value: Object.freeze(logos), writable: false, configurable: false });
})();
