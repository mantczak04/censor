# Messenger Style Redactor

Personal browser extension (Chrome and Firefox, single codebase loaded as unpacked in both) that intercepts message sending in a configured Messenger group and rewrites the message in a configured style (e.g. pirate) using a local LLM via Ollama before the message is actually sent.

## Stack and design decisions

- **Vanilla JavaScript** — no bundler, no TypeScript, no framework. The whole project is ~6 files.
- **Manifest V3**, single manifest for both browsers (Firefox supports MV3 + the `chrome.*` namespace as an alias).
- **Ollama locally** on `http://localhost:11434`, endpoint `/api/chat`.
- **Default model: `gemma4:e4b`** — 8B Q4_K_M (~9.6 GB), good Polish + handles creative rewrites well (verified against pirate prompt). Configurable in the popup. Alternatives: `qwen3.5:4b` (faster compromise), `qwen2.5:3b` (fastest, weaker quality).
- **Target: `messenger.com` only** (not facebook.com/messages, not the chat bubbles on facebook.com). More stable DOM.

## How it works (flow)

1. Content script loads on `https://www.messenger.com/*`.
2. A `MutationObserver` on `document.body` waits for the composer (Lexical contenteditable) and the Send button to appear.
3. The content script reads `window.location.pathname`, extracts the thread ID (the part after `/t/`), and compares it against the `threadId` from config. If it doesn't match, the extension does nothing — Messenger behaves normally.
4. If it matches, attach two listeners in **capture phase**:
   - `keydown` on the composer: if `e.key === "Enter" && !e.shiftKey` → intercept.
   - `click` on the Send button: always → intercept.
   Both call `e.preventDefault()` + `e.stopImmediatePropagation()` to block React's handler **before** it runs.
5. Extract the text from the composer (`composer.innerText`).
6. Set `isProcessing = true` (guards against double-send) and set the extension icon badge to `"..."`.
7. Call Ollama via the background script, so popup/content scripts do not make cross-origin requests directly:
   ```
   POST http://localhost:11434/api/chat
   Content-Type: application/json
   {
     "model": "<from config>",
     "stream": false,
     "keep_alive": "30m",
     "options": {
       "temperature": 0.8,
       "num_predict": 200
     },
     "messages": [
       { "role": "system", "content": "<masterPrompt from config>" },
       { "role": "user", "content": "<text from composer>" }
     ]
   }
   ```
8. **Timeout: 60 seconds.** `gemma4:e4b` (8B) on CPU realistically: cold start 15–30s, warm 8–15s. 60s gives headroom for cold start + longer messages. Configurable in the popup (optional).
9. **Success**: parse `response.message.content`, replace the composer text:
   ```js
   composer.focus();
   document.execCommand('selectAll');
   document.execCommand('insertText', false, newText);
   ```
   This dispatches proper `beforeinput`/`input` events that Lexical (React state) listens to. Setting `composer.innerText = ...` **does NOT work** — Lexical ignores it.
   Then call `sendButton.click()` — React's handler will see the already-updated state with our replacement and send.
   Clear the badge, set `isProcessing = false`.
10. **Failure** (timeout, network error, Ollama down, malformed response, 4xx/5xx, model not found): badge turns red `"!"`, error content saved to `chrome.storage.local.lastError`. Popup displays the error when opened. **The message is NOT sent.**
11. Race protection: if `isProcessing === true` when another intercept fires, ignore it (still block the event, just don't start another generation).

## Configuration

Stored in `chrome.storage.local`, edited via popup (`popup.html` + `popup.js`):

| Key            | Type   | Description                                                                                |
|----------------|--------|--------------------------------------------------------------------------------------------|
| `threadId`     | string | The part after `/t/` in the group's URL. Empty = extension inactive.                       |
| `masterPrompt` | string | System message sent to the LLM. Default — see below.                                       |
| `model`        | string | Ollama model name, default `gemma4:e4b`.                                                   |
| `ollamaUrl`    | string | Ollama base URL, default `http://127.0.0.1:11434`.                                         |
| `lastError`    | string | Last error to display in the popup. Cleared on success or manually from the popup.         |

**Default master prompt** (Polish, since the actual use case is Polish-language messaging — replace with English equivalent if your target language differs):

```
Jesteś redaktorem tekstu. Twoim zadaniem jest przeredagować wiadomość użytkownika w stylu: PIRATA Z KARAIBÓW.
Zachowaj sens i język polski.
Odpowiedz TYLKO przeredagowaną wiadomością, bez komentarza, bez wstępu, bez wyjaśnienia, bez cudzysłowów.
```

(The bit after `w stylu:` is what you'll edit most often.)

## File structure

```
/
├── manifest.json
├── popup.html
├── popup.js
├── popup.css         (optional, can be inlined)
├── content.js
├── background.js     (optional — only if badge state requires a service worker; to evaluate)
├── icons/
│   ├── 16.png
│   ├── 48.png
│   └── 128.png
├── README.md
└── CLAUDE.md
```

## Manifest — key fields

- `manifest_version: 3`
- `host_permissions`: `["http://localhost:11434/*"]`
- `content_scripts`: matches `["https://www.messenger.com/*"]`, runs `["content.js"]`, `run_at: "document_idle"`
- `permissions`: `["storage"]`
- `action.default_popup`: `"popup.html"`
- `action.default_icon`: object with 16/48/128
- `browser_specific_settings.gecko.id`: `"messenger-redactor@local"` (Firefox; ignored by Chrome)
- `background`: include both `service_worker: "background.js"` and `scripts: ["background.js"]` if badge management needs a background context. Chrome uses the service worker; Firefox uses background scripts because extension service workers are not supported there yet.

## Cross-browser

- Use the `chrome.*` namespace — works in both.
- No polyfill.
- Loading:
  - **Chrome**: `chrome://extensions` → Developer mode → Load unpacked → select the folder.
  - **Firefox**: `about:debugging` → This Firefox → Load Temporary Add-on → pick any file in the folder. **Note: temporary**, vanishes after Firefox restart. For persistence either use signed builds (overkill for personal use) or use Firefox Developer Edition / Nightly with `xpinstall.signatures.required = false` in `about:config`.

## Ollama — LLM-side requirements

- Ollama service must be running in the background (systemd on Debian — see separate setup).
- Model needs to be pulled: `ollama pull gemma4:e4b` (~9.6 GB) or another preferred model. Verified against Polish pirate prompt — does not refuse, does not prepend a disclaimer.
- Ollama requests should go through `background.js` using `host_permissions`, not directly from `content.js` or the popup. Browser requests still carry an extension `Origin`; for personal local use `OLLAMA_ORIGINS=*` is the simplest fix when Ollama returns network/CORS errors despite curl working.

## Known risks and fallbacks

| Risk                                                              | Mitigation / fallback                                                                              |
|-------------------------------------------------------------------|----------------------------------------------------------------------------------------------------|
| `execCommand` stops working (deprecated for years but still alive)| Fallback to keyboard shortcut mode: Ctrl+Shift+P, user sees the result in the field, hits Send themselves. |
| Send button selector breaks after a Messenger update              | Multiple fallback selectors (`[aria-label*="ślij"]` PL, `[aria-label*="end"]` EN). Show error in popup. |
| Lexical state doesn't update after `insertText`                   | Same — fallback to keyboard shortcut mode.                                                         |
| Race condition (user spams Send during generation)                | `isProcessing` flag, blocks further intercepts.                                                    |
| Messenger locale change (e.g. German)                             | Add another selector to the fallback list.                                                         |
| Ollama cold start times out (very weak CPU)                       | Bump timeout in config or switch to a smaller model.                                               |
| User switches to a different thread mid-generation                | After success, verify we're still in the same thread before sending. If not — abort, error in popup. |


## Implementation order (STEP BY STEP — not one-shot)

1. **Scaffold** — manifest, empty files, icons. Load in Chrome + Firefox, verify no errors in the extension console.
2. **Popup config** — three form fields (threadId, masterPrompt as textarea, model), save/load from `chrome.storage.local`. A "Last error" section if `lastError` exists.
3. **`callOllama(text, config) → Promise<string>` function** in `content.js` (or a `utils.js` injected into content.js). Test: a button in the popup that calls it with dummy text and shows the result. **Don't touch Messenger yet.**
4. **Thread detection** — content script reads URL, logs to console whether it matches the config.
5. **Composer + Send button detection** — `MutationObserver` finds the elements, logs them. Verify the selectors manually in Messenger DevTools.
6. **Interception (blocking only)** — capture-phase keydown/click, `stopImmediatePropagation`, log "intercepted". Verify that Enter in the target group does NOT send. In other threads it sends normally.
7. **Text replacement (no Ollama yet)** — after intercept, replace the text with a hardcoded `"YARRR test"` via `execCommand`. Verify Lexical accepts the change (you can keep typing afterwards without glitches).
8. **Programmatic Send click** — after replacement, call `sendButton.click()`. Verify the message goes out.
9. **Wire Ollama** — replace the hardcoded text with the result from `callOllama`.
10. **Badge + error UX** — `chrome.action.setBadgeText`, `setBadgeBackgroundColor`. Error path: write to storage, render in popup.
11. **Edge cases** — `isProcessing` flag, Shift+Enter (newline, not intercept), URL change mid-generation (abort).

End each step with a commit. After every step do a manual test before moving on.