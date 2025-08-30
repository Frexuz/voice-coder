// apps/frontend/global.d.ts

interface Window {
  SpeechRecognition: typeof SpeechRecognition;
  webkitSpeechRecognition: typeof SpeechRecognition;
}

declare class SpeechRecognition extends EventTarget {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onaudioend?: (ev: Event) => any;
  onaudiostart?: (ev: Event) => any;
  onend?: (ev: Event) => any;
  onerror?: (ev: any) => any;
  onnomatch?: (ev: any) => any;
  onresult?: (ev: any) => any;
  onsoundend?: (ev: Event) => any;
  onsoundstart?: (ev: Event) => any;
  onspeechend?: (ev: Event) => any;
  onspeechstart?: (ev: Event) => any;
  onstart?: (ev: Event) => any;
}
