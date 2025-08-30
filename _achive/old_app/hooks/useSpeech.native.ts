import { useCallback, useEffect, useRef, useState } from 'react';
import Voice from '@react-native-voice/voice';

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
  const gotSpeechRef = useRef(false);

  useEffect(() => {
    return () => {
      try {
        Voice.removeAllListeners();
        Voice.destroy().catch(() => {});
      } catch {}
    };
  }, []);

  const onMicDown = useCallback(() => {
    setError(undefined);
    setIsListening(true);
    gotSpeechRef.current = false;
    try {
      Voice.removeAllListeners();
      Voice.onSpeechError = (e: unknown) => {
        const msg = (e && typeof e === 'object' && 'error' in e)
          ? String((e as any).error?.message || 'Speech error')
          : 'Speech error';
        setError(msg);
        setIsListening(false);
      };
      Voice.onSpeechEnd = () => {
        if (!gotSpeechRef.current) setIsListening(false);
      };
      Voice.onSpeechResults = (e: unknown) => {
        const val = (e && typeof e === 'object' && 'value' in e) ? (e as any).value : undefined;
        const text = (Array.isArray(val) && val[0]) || '';
        if (text && String(text).trim()) {
          gotSpeechRef.current = true;
          setIsListening(false);
          onRecognized(String(text));
        }
      };
      Voice.start('en-US');
    } catch (err: unknown) {
      const msg = (err && typeof err === 'object' && 'message' in err)
        ? String((err as { message?: string }).message || 'Failed to start voice')
        : 'Failed to start voice';
      setError(msg);
      setIsListening(false);
    }
  }, [onRecognized]);

  const onMicUp = useCallback(() => {
    Voice.stop().catch(() => {});
  }, []);

  return { canUse: true, isListening, error, onMicDown, onMicUp };
}
