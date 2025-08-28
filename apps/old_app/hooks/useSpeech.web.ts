import { useCallback, useEffect, useRef, useState } from 'react';

export type UseSpeech = {
  canUse: boolean;
  isListening: boolean;
  error?: string;
  onMicDown: () => void;
  onMicUp: () => void;
};

export default function useSpeech(onRecognized: (text: string) => void): UseSpeech {
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [canUse, setCanUse] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const gotSpeechRef = useRef(false);

  useEffect(() => {
    const w = typeof window !== 'undefined' ? (window as unknown as Record<string, unknown>) : undefined;
    const SR = (w && (w['SpeechRecognition'] || w['webkitSpeechRecognition'])) as unknown;
    setCanUse(!!SR);
    return () => {
      try { recognitionRef.current?.stop(); } catch {}
      recognitionRef.current = null;
    };
  }, []);

  const onMicDown = useCallback(() => {
    setError(undefined);
    if (!canUse) return;
    const w = window as unknown as Record<string, unknown>;
    const SR = (w['SpeechRecognition'] || w['webkitSpeechRecognition']) as unknown;
    if (typeof SR !== 'function') return;
    try {
      const rec: SpeechRecognition = new (SR as new () => SpeechRecognition)();
      rec.lang = 'en-US';
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      recognitionRef.current = rec;
      setIsListening(true);
      gotSpeechRef.current = false;
      rec.onresult = (ev: SpeechRecognitionEventLike) => {
        const text = ev?.results?.[0]?.[0]?.transcript || '';
        if (text.trim()) { gotSpeechRef.current = true; setIsListening(false); onRecognized(text); }
      };
      rec.onerror = () => { setError('Speech error'); setIsListening(false); };
      rec.onend = () => { if (!gotSpeechRef.current) setIsListening(false); };
      rec.start();
    } catch (e: unknown) {
      const msg = (e && typeof e === 'object' && 'message' in e) ? String((e as { message?: string }).message || 'Failed to start speech') : 'Failed to start speech';
      setError(msg);
      setIsListening(false);
    }
  }, [canUse, onRecognized]);

  const onMicUp = useCallback(() => {
    try { recognitionRef.current?.stop(); } catch {}
  }, []);

  return { canUse, isListening, error, onMicDown, onMicUp };
}
