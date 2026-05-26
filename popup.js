console.log("[messenger-redactor] popup loaded");

const DEFAULT_MASTER_PROMPT = `Jesteś redaktorem tekstu. Twoim zadaniem jest przeredagować wiadomość użytkownika w stylu: PIRATA Z KARAIBÓW.
Zachowaj sens i język polski.
Odpowiedz TYLKO przeredagowaną wiadomością, bez komentarza, bez wstępu, bez wyjaśnienia, bez cudzysłowów.`;

const DEFAULTS = {
  threadId: "",
  model: "gemma4:e4b",
  ollamaUrl: "http://127.0.0.1:11434",
  masterPrompt: DEFAULT_MASTER_PROMPT,
  timeoutMs: 60000,
};

const threadIdEl = document.getElementById("threadId");
const modelEl = document.getElementById("model");
const ollamaUrlEl = document.getElementById("ollamaUrl");
const timeoutMsEl = document.getElementById("timeoutMs");
const masterPromptEl = document.getElementById("masterPrompt");
const saveBtn = document.getElementById("save");
const testBtn = document.getElementById("testOllama");
const statusEl = document.getElementById("status");
const testResultEl = document.getElementById("testResult");
const errorSection = document.getElementById("errorSection");
const lastErrorEl = document.getElementById("lastError");
const clearErrorBtn = document.getElementById("clearError");

function getFromStorage(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, (items) => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message));
      } else {
        resolve(items);
      }
    });
  });
}

function setInStorage(items) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(items, () => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message));
      } else {
        resolve();
      }
    });
  });
}

function removeFromStorage(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.remove(keys, () => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message));
      } else {
        resolve();
      }
    });
  });
}

function sendRuntimeMessage(message) {
  chrome.runtime.sendMessage(message, () => {
    if (chrome.runtime.lastError) {
      return;
    }
  });
}

function showStatus(text, ok) {
  statusEl.hidden = false;
  statusEl.textContent = text;
  statusEl.className = ok ? "status ok" : "status err";
}

function getFormConfig() {
  return {
    threadId: threadIdEl.value.trim(),
    model: modelEl.value.trim() || DEFAULTS.model,
    ollamaUrl: ollamaUrlEl.value.trim() || DEFAULTS.ollamaUrl,
    masterPrompt: masterPromptEl.value.trim() || DEFAULTS.masterPrompt,
    timeoutMs: Number(timeoutMsEl.value) || DEFAULTS.timeoutMs,
  };
}

function fillForm(data) {
  threadIdEl.value = data.threadId ?? DEFAULTS.threadId;
  modelEl.value = data.model ?? DEFAULTS.model;
  ollamaUrlEl.value = data.ollamaUrl ?? DEFAULTS.ollamaUrl;
  masterPromptEl.value = data.masterPrompt ?? DEFAULTS.masterPrompt;
  timeoutMsEl.value = data.timeoutMs ?? DEFAULTS.timeoutMs;
}

function showLastError(err) {
  if (err) {
    errorSection.hidden = false;
    lastErrorEl.textContent = err;
  } else {
    errorSection.hidden = true;
    lastErrorEl.textContent = "";
  }
}

async function load() {
  const stored = await getFromStorage([
    "threadId",
    "masterPrompt",
    "model",
    "ollamaUrl",
    "timeoutMs",
    "lastError",
  ]);
  fillForm({
    threadId: stored.threadId ?? DEFAULTS.threadId,
    model: stored.model ?? DEFAULTS.model,
    ollamaUrl: stored.ollamaUrl ?? DEFAULTS.ollamaUrl,
    masterPrompt: stored.masterPrompt ?? DEFAULTS.masterPrompt,
    timeoutMs: stored.timeoutMs ?? DEFAULTS.timeoutMs,
  });
  showLastError(stored.lastError);
}

saveBtn.addEventListener("click", async () => {
  const cfg = getFormConfig();
  await setInStorage(cfg);
  showStatus("Saved.", true);
});

clearErrorBtn.addEventListener("click", async () => {
  await removeFromStorage("lastError");
  showLastError(null);
  sendRuntimeMessage({ type: "badge", text: "", color: null });
});

testBtn.addEventListener("click", async () => {
  const cfg = getFormConfig();
  testResultEl.hidden = true;
  showStatus("Calling Ollama…", true);
  testBtn.disabled = true;
  try {
    const result = await callOllama("Cześć, jak się masz?", cfg);
    testResultEl.hidden = false;
    testResultEl.textContent = result;
    showStatus("Ollama OK.", true);
  } catch (err) {
    testResultEl.hidden = true;
    showStatus(err?.message ?? String(err), false);
  } finally {
    testBtn.disabled = false;
  }
});

load();
