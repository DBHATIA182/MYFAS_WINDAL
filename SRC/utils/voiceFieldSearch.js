/** Web Speech API helper for field-level voice search (party name, etc.). */

export function isSpeechRecognitionSupported() {
  if (typeof window === 'undefined') return false;
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

/**
 * Start one-shot speech recognition; returns recognition instance or null.
 * @param {{ onText?: (text: string) => void, onError?: (code: string) => void, onStart?: () => void, onEnd?: () => void, lang?: string }} opts
 */
export function listenForSearchText(opts = {}) {
  const { onText, onError, onStart, onEnd, lang = 'en-IN' } = opts;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (typeof SR !== 'function') {
    onError?.('not-supported');
    return null;
  }

  const recognition = new SR();
  recognition.lang = lang;
  recognition.interimResults = false;
  recognition.maxAlternatives = 5;
  recognition.continuous = false;

  recognition.onstart = () => onStart?.();
  recognition.onend = () => onEnd?.();
  recognition.onerror = (event) => {
    onEnd?.();
    onError?.(String(event?.error || 'error'));
  };
  recognition.onresult = (event) => {
    const result = event?.results?.[0];
    if (!result) return;
    const alternatives = [];
    for (let i = 0; i < result.length; i += 1) {
      const transcript = String(result[i]?.transcript || '').trim();
      if (transcript) alternatives.push(transcript);
    }
    if (alternatives.length) onText?.(alternatives);
  };

  try {
    recognition.start();
  } catch (err) {
    onEnd?.();
    onError?.(String(err?.message || 'start-failed'));
    return null;
  }

  return recognition;
}
