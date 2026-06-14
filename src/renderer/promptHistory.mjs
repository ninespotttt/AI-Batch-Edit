export function normalizePromptHistory(value, limit = 30) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const result = [];
  for (const item of value) {
    const text = String(item || '').trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
    if (result.length >= limit) break;
  }
  return result;
}

export function addPromptToHistory(history, prompt, limit = 30) {
  const text = String(prompt || '').trim();
  if (!text) return normalizePromptHistory(history, limit);
  return normalizePromptHistory([text, ...normalizePromptHistory(history, limit)], limit);
}

export function applyHistoryPrompt(currentPrompt, historyPrompt) {
  const current = String(currentPrompt || '');
  const text = String(historyPrompt || '').trim();
  if (!text) return current;
  if (!current.trim()) return text;
  return `${current.trimEnd()} ${text}`;
}
