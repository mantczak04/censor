# Messenger Style Redactor

Personal browser extension (Chrome and Firefox) that intercepts message sending in one configured Messenger group on [messenger.com](https://www.messenger.com), rewrites the text via a local [Ollama](https://ollama.com) model, then sends the rewritten message.

## Install the extension

**Chrome:** `chrome://extensions` → Developer mode → Load unpacked → select this folder.

**Firefox:** `about:debugging` → This Firefox → Load Temporary Add-on → pick any file in this folder. Temporary add-ons are removed when Firefox restarts.

The manifest intentionally declares both MV3 background forms: Chrome uses `background.service_worker`, while Firefox uses `background.scripts` because extension service workers are not supported there yet.

## Configure

Open the extension popup:

| Field | Description |
|-------|-------------|
| **Thread ID** | The segment after `/t/` in the group URL (e.g. `https://www.messenger.com/t/1234567890` → `1234567890`). Leave empty to disable. |
| **Ollama model** | Default `gemma4:e4b` |
| **Ollama URL** | Default `http://127.0.0.1:11434`. Try `http://localhost:11434` if needed. |
| **Timeout (ms)** | Default `60000` |
| **Master prompt** | System prompt for the rewriter (default: Polish pirate style) |

Use **Test Ollama** to verify connectivity without opening Messenger.

## Ollama setup

1. Install and run Ollama (e.g. `systemctl enable --now ollama` on Debian).
2. Pull a model: `ollama pull gemma4:e4b`
3. The extension sends Ollama requests from its background script using host permissions for `127.0.0.1` and `localhost`. Browser requests still include an extension `Origin` header, so configure Ollama to allow it. For a personal local setup, the broad option is:

   ```ini
   [Service]
   Environment="OLLAMA_ORIGINS=*"
   ```

   Then `systemctl daemon-reload && systemctl restart ollama`.

   If you prefer not to use `*`, add the exact extension origin from `chrome://extensions` (Chrome) or `about:debugging` (Firefox), for example `moz-extension://<uuid>`. Some Ollama builds reject `moz-extension://*` / `chrome-extension://*` wildcard patterns even when curl without an `Origin` header works.

## How it works

On the configured thread only, Enter (without Shift) and the Send button are intercepted. The content script asks the background script to call `POST http://localhost:11434/api/chat`, replaces the composer text via `document.execCommand('insertText')` (Lexical-compatible), then clicks Send.

Errors are shown in the popup and as a red `!` badge; the original message is not sent.

## Files

- `manifest.json` — MV3 manifest with Chrome + Firefox background declarations
- `content.js` — Messenger interception and rewrite flow
- `background.js` — toolbar badge updates and Ollama HTTP requests
- `ollama.js` — shared message-based Ollama client (content script + popup)
- `popup.html` / `popup.js` / `popup.css` — settings UI

Spec and implementation notes: [.ai/AGENTS.md](.ai/AGENTS.md)
