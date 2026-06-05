import React, { useCallback, useEffect, useRef, useState } from 'react';
import { IconVoice } from './ToolbarIcons';
import { isSpeechRecognitionSupported, listenForSearchText } from '../utils/voiceFieldSearch';

/** Mic button — speaks into a search field (party name, etc.). */
export default function VoiceSearchButton({
  onTranscript,
  disabled = false,
  title = 'Voice search',
  className = '',
}) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef(null);

  useEffect(() => {
    setSupported(isSpeechRecognitionSupported());
  }, []);

  const stopListening = useCallback(() => {
    try {
      recognitionRef.current?.stop?.();
    } catch (_) {}
    recognitionRef.current = null;
    setListening(false);
  }, []);

  useEffect(() => () => stopListening(), [stopListening]);

  const handleClick = () => {
    if (disabled) return;
    if (listening) {
      stopListening();
      return;
    }
    if (!supported) {
      alert('Voice search is not supported on this device/browser.');
      return;
    }

    recognitionRef.current = listenForSearchText({
      onStart: () => setListening(true),
      onEnd: () => {
        setListening(false);
        recognitionRef.current = null;
      },
      onText: (text) => onTranscript?.(text),
      onError: (code) => {
        if (code === 'not-supported') {
          alert('Voice search is not supported on this device/browser.');
          return;
        }
        if (code === 'aborted' || code === 'no-speech') return;
        alert('Voice recognition failed. Please try again.');
      },
    });
  };

  if (!supported) return null;

  return (
    <button
      type="button"
      className={[
        'voice-search-btn',
        'toolbar-icon-btn',
        'toolbar-icon-btn--voice',
        listening ? 'voice-search-btn--listening toolbar-icon-btn--listening' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={handleClick}
      disabled={disabled}
      title={listening ? 'Listening… (tap to stop)' : title}
      aria-label={listening ? 'Listening for search text' : title}
    >
      <IconVoice />
    </button>
  );
}
