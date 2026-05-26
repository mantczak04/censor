console.log("[messenger-redactor] content script loaded");

const DEFAULT_MASTER_PROMPT = `Jesteś redaktorem tekstu. Twoim zadaniem jest przeredagować wiadomość użytkownika w stylu: PIRATA Z KARAIBÓW.
Zachowaj sens i język polski.
Odpowiedz TYLKO przeredagowaną wiadomością, bez komentarza, bez wstępu, bez wyjaśnienia, bez cudzysłowów.`;

const SEND_SELECTORS = [
  '[aria-label*="ślij"]',
  '[aria-label*="end"]',
  '[aria-label*="Send"]',
];

let config = null;
let isProcessing = false;
let attached = false;
let composerEl = null;
let sendButtonEl = null;
let composerKeydownHandler = null;
let sendClickHandler = null;
let allowNextSendClick = false;

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

function getCurrentThreadId() {
  const match = window.location.pathname.match(/\/t\/([^/]+)/);
  return match ? match[1] : null;
}

function isTargetThread() {
  if (!config?.threadId) return false;
  const current = getCurrentThreadId();
  return current !== null && current === config.threadId;
}

async function loadConfig() {
  const stored = await getFromStorage([
    "threadId",
    "masterPrompt",
    "model",
    "ollamaUrl",
    "timeoutMs",
  ]);
  config = {
    threadId: stored.threadId ?? "",
    masterPrompt: stored.masterPrompt ?? DEFAULT_MASTER_PROMPT,
    model: stored.model ?? "gemma4:e4b",
    ollamaUrl: stored.ollamaUrl ?? "http://127.0.0.1:11434",
    timeoutMs: stored.timeoutMs ?? 60000,
  };
  return config;
}

function logThreadStatus() {
  const current = getCurrentThreadId();
  const target = config?.threadId || "(none)";
  if (!config?.threadId) {
    console.log("[messenger-redactor] inactive — threadId not configured");
    return;
  }
  if (isTargetThread()) {
    console.log(`[messenger-redactor] thread match: ${current}`);
  } else {
    console.log(`[messenger-redactor] thread mismatch: current=${current ?? "none"}, target=${target}`);
  }
}

function findComposer() {
  const candidates = document.querySelectorAll(
    '[contenteditable="true"][role="textbox"]'
  );
  for (const el of candidates) {
    if (el.offsetParent !== null) return el;
  }
  const fallback = document.querySelector('[contenteditable="true"]');
  if (fallback && fallback.offsetParent !== null) return fallback;
  return null;
}

function findSendButton() {
  for (const sel of SEND_SELECTORS) {
    const btn = document.querySelector(sel);
    if (btn) {
      console.log(`[messenger-redactor] send button matched: ${sel}`);
      return btn;
    }
  }
  return null;
}

function setBadge(text, color) {
  sendRuntimeMessage({ type: "badge", text, color });
}

async function setError(message) {
  await setInStorage({ lastError: message });
  setBadge("!", "#cc0000");
}

async function clearError() {
  await removeFromStorage("lastError");
  setBadge("", null);
}

function replaceComposerText(composer, newText) {
  composer.focus();
  document.execCommand("selectAll");
  document.execCommand("insertText", false, newText);
}

function blockEvent(e) {
  e.preventDefault();
  e.stopImmediatePropagation();
}

function onComposerKeydown(e) {
  if (e.key !== "Enter" || e.shiftKey) return;
  blockEvent(e);
  handleIntercept("enter");
}

function onSendClick(e) {
  if (allowNextSendClick) {
    allowNextSendClick = false;
    return;
  }

  blockEvent(e);
  handleIntercept("send");
}

async function handleIntercept(source) {
  if (!composerEl || !sendButtonEl) return;

  if (isProcessing) {
    console.log("[messenger-redactor] ignored — already processing");
    return;
  }

  const text = composerEl.innerText?.trim() ?? "";
  if (!text) {
    await setError("Cannot rewrite an empty message.");
    return;
  }

  const threadIdAtStart = getCurrentThreadId();
  if (!threadIdAtStart || threadIdAtStart !== config.threadId) {
    await setError("Thread changed before rewrite could start.");
    return;
  }

  isProcessing = true;
  setBadge("...", "#888888");
  console.log(`[messenger-redactor] intercepted (${source}), calling Ollama`);

  try {
    const newText = await callOllama(text, config);

    if (getCurrentThreadId() !== threadIdAtStart) {
      throw new Error("Thread changed during generation — message not sent.");
    }

    replaceComposerText(composerEl, newText);

    if (getCurrentThreadId() !== threadIdAtStart) {
      throw new Error("Thread changed after rewrite — message not sent.");
    }

    allowNextSendClick = true;
    sendButtonEl.click();
    allowNextSendClick = false;
    await clearError();
    console.log("[messenger-redactor] message sent with rewritten text");
  } catch (err) {
    allowNextSendClick = false;
    const msg = err?.message ?? String(err);
    console.error("[messenger-redactor]", msg);
    await setError(msg);
  } finally {
    isProcessing = false;
  }
}

function detachListeners() {
  if (composerEl && composerKeydownHandler) {
    composerEl.removeEventListener("keydown", composerKeydownHandler, true);
  }
  if (sendButtonEl && sendClickHandler) {
    sendButtonEl.removeEventListener("click", sendClickHandler, true);
  }
  composerKeydownHandler = null;
  sendClickHandler = null;
  composerEl = null;
  sendButtonEl = null;
  attached = false;
}

function attachListeners() {
  if (!isTargetThread()) {
    detachListeners();
    return;
  }

  const composer = findComposer();
  const sendBtn = findSendButton();
  if (!composer || !sendBtn) {
    detachListeners();
    return;
  }

  if (attached && composer === composerEl && sendBtn === sendButtonEl) return;

  detachListeners();
  composerEl = composer;
  sendButtonEl = sendBtn;
  composerKeydownHandler = onComposerKeydown;
  sendClickHandler = onSendClick;

  composerEl.addEventListener("keydown", composerKeydownHandler, true);
  sendButtonEl.addEventListener("click", sendClickHandler, true);
  attached = true;
  console.log("[messenger-redactor] listeners attached", { composer: composerEl, send: sendButtonEl });
}

function sync() {
  logThreadStatus();
  if (isTargetThread()) {
    const composer = findComposer();
    const sendBtn = findSendButton();
    if (composer && sendBtn) {
      console.log("[messenger-redactor] composer + send found");
      attachListeners();
    }
  } else {
    detachListeners();
  }
}

async function init() {
  await loadConfig();
  sync();

  const observer = new MutationObserver(() => sync());
  observer.observe(document.body, { childList: true, subtree: true });

  window.addEventListener("popstate", () => sync());

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.threadId || changes.masterPrompt || changes.model || changes.ollamaUrl || changes.timeoutMs) {
      loadConfig().then(sync);
    }
  });
}

init();
