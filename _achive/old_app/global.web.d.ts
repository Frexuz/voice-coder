// Minimal Web SpeechRecognition declarations for Expo web builds
// Keeps TS happy when checking window.SpeechRecognition / webkitSpeechRecognition
export {};

declare global {
  interface Window {
    webkitSpeechRecognition?: new () => SpeechRecognition;
    SpeechRecognition?: new () => SpeechRecognition;
  }

  interface SpeechRecognitionEventResult { transcript?: string }
  interface SpeechRecognitionEventLike { results?: SpeechRecognitionEventResult[][] }

  interface SpeechRecognition {
    lang: string;
    interimResults: boolean;
    maxAlternatives: number;
    start: () => void;
    stop: () => void;
    onresult: (ev: SpeechRecognitionEventLike) => void;
    onnomatch?: (ev?: unknown) => void;
    onerror?: (ev?: unknown) => void;
    onend?: (ev?: unknown) => void;
  }
}
