console.log("[messenger-redactor] background loaded");

const DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434";

function getOllamaChatUrl(config) {
  const base = config?.ollamaUrl || DEFAULT_OLLAMA_URL;
  try {
    return new URL("/api/chat", base).toString();
  } catch (_err) {
    throw new Error(`Invalid Ollama URL: ${base}`);
  }
}

async function requestOllama(text, config) {
  const controller = new AbortController();
  const timeoutMs = config?.timeoutMs ?? 60000;
  const chatUrl = getOllamaChatUrl(config);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(chatUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: config?.model,
        stream: false,
        keep_alive: "30m",
        options: { temperature: 0.8, num_predict: 200 },
        messages: [
          { role: "system", content: config?.masterPrompt },
          { role: "user", content: text },
        ],
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Ollama HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}`);
    }

    const data = await res.json();
    const content = data?.message?.content;
    if (typeof content !== "string") throw new Error("Malformed Ollama response");

    const trimmed = content.trim();
    if (!trimmed) throw new Error("Ollama returned an empty response");
    return trimmed;
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error(`Ollama timeout after ${timeoutMs}ms`);
    }
    const message = err?.message ?? String(err);
    if (message.includes("NetworkError") || message.includes("Failed to fetch")) {
      throw new Error(
        `Network error contacting Ollama at ${chatUrl}. If curl works, Ollama is likely rejecting the browser Origin header. Set OLLAMA_ORIGINS=* or the exact moz-extension:// origin for the Ollama service, then restart Ollama.`
      );
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "ollama") {
    requestOllama(msg.text, msg.config)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((err) => sendResponse({ ok: false, error: err?.message ?? String(err) }));
    return true;
  }

  if (msg?.type !== "badge") return false;
  const badgeApi = chrome.action ?? chrome.browserAction;
  const { text, color } = msg;
  if (text) {
    badgeApi.setBadgeText({ text });
    if (color) {
      badgeApi.setBadgeBackgroundColor({ color });
    }
  } else {
    badgeApi.setBadgeText({ text: "" });
  }
  sendResponse({ ok: true });
  return true;
});
