# censor - message style redactor

browser extension (chrome/firefox) that redacts the message in given style using local LLM model.

>>>ONLY messenger.com SUPPORTED<<<

## Install the extension

**Chrome:** `chrome://extensions` → Developer mode → Load unpacked → select this folder.

**Firefox:** `about:debugging` → This Firefox → Load Temporary Add-on → pick manifest.json

## Configure

Open the extension popup:

| Field | Description |
|-------|-------------|
| **Thread ID** | The segment after `/t/` in the group URL (e.g. `https://www.messenger.com/t/1234567890` → `1234567890`). Leave empty to disable. |
| **Ollama model** | Default `gemma4:e4b` |
| **Ollama URL** | Default `http://127.0.0.1:11434`. Try `http://localhost:11434` if needed. |
| **Timeout (ms)** | Default `60000 ms` |
| **Master prompt** | System prompt for the rewriter (default: pirate style, polish language) |

Use **Test Ollama** to verify connectivity without opening Messenger.

## How it works

on the configured thread only, Enter (without Shift) and the Send button are intercepted. The content script asks the background script to call `POST http://localhost:11434/api/chat`, replaces the composer text via `document.execCommand('insertText')` (Lexical-compatible), then clicks Send.

Errors are shown in the popup and as a red `!` badge; the original message is not sent.

## Files

- `manifest.json` — MV3 manifest with Chrome + Firefox background declarations
- `content.js` — Messenger interception and rewrite flow
- `background.js` — toolbar badge updates and Ollama HTTP requests
- `ollama.js` — shared message-based Ollama client (content script + popup)
- `popup.html` / `popup.js` / `popup.css` — settings UI

Spec and implementation notes: [.ai/AGENTS.md](.ai/AGENTS.md)
