import { Platform } from 'react-native';
import type { UseSpeech as UseSpeechType } from './useSpeech.native';

// Dynamically require platform-specific implementation to avoid bundling native module on web
export default function useSpeech(onRecognized: (text: string) => void): UseSpeechType {
  if (Platform.OS === 'web') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('./useSpeech.web') as { default: (cb: (t: string) => void) => UseSpeechType };
    return mod.default(onRecognized);
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('./useSpeech.native') as { default: (cb: (t: string) => void) => UseSpeechType };
  return mod.default(onRecognized);
}

export type UseSpeech = UseSpeechType;
