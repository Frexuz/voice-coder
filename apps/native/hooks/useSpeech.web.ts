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
  const bufferRef = useRef('');
  const emittedRef = useRef(false);

  useEffect(() => {
    const w = typeof window !== 'undefined' ? (window as unknown as Record<string, unknown>) : undefined;
    const SR = w && (w['SpeechRecognition'] || w['webkitSpeechRecognition']);
    setCanUse(!!SR);
    return () => {
      try { recognitionRef.current?.stop(); } catch {}
      recognitionRef.current = null;
    };
  }, []);

  const finalizeOnce = useCallback(() => {
    if (emittedRef.current) return;
    const text = bufferRef.current.trim();
    if (text) { emittedRef.current = true; onRecognized(text); }
  }, [onRecognized]);

  const onMicDown = useCallback(() => {
    setError(undefined);
    if (!canUse) return;
  const w = window as unknown as Record<string, unknown>;
  const SR = w['SpeechRecognition'] || w['webkitSpeechRecognition'];
    if (typeof SR !== 'function') return;
    try {
      const rec: SpeechRecognition = new (SR as new () => SpeechRecognition)();
      rec.lang = 'en-US';
      rec.interimResults = true;
      rec.maxAlternatives = 1;
      recognitionRef.current = rec;
      setIsListening(true);
      gotSpeechRef.current = false;
      emittedRef.current = false;
      bufferRef.current = '';
      rec.onresult = (ev: SpeechRecognitionEventLike) => {
        const res = ev?.results;
        const last = res?.[res.length - 1];
        const best = last?.[0];
        const text = best?.transcript || '';
        if (typeof text === 'string') bufferRef.current = text;
        if (text.trim()) gotSpeechRef.current = true;
      };
      rec.onerror = () => { setError('Speech error'); setIsListening(false); };
      rec.onend = () => {
        setIsListening(false);
        finalizeOnce();
      };
      rec.start();
    } catch (e: unknown) {
      const msg = (e && typeof e === 'object' && 'message' in e) ? String((e as { message?: string }).message || 'Failed to start speech') : 'Failed to start speech';
      setError(msg);
      setIsListening(false);
    }
  }, [canUse, finalizeOnce]);

  const onMicUp = useCallback(() => {
    try { recognitionRef.current?.stop(); } catch { finalizeOnce(); setIsListening(false); }
  }, [finalizeOnce]);

  return { canUse, isListening, error, onMicDown, onMicUp };
}
