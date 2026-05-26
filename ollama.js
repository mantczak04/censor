async function callOllama(text, config) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: "ollama", text, config }, (response) => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message));
        return;
      }

      if (!response) {
        reject(new Error("No response from extension background script."));
        return;
      }

      if (!response.ok) {
        reject(new Error(response.error || "Ollama request failed."));
        return;
      }

      resolve(response.result);
    });
  });
}
