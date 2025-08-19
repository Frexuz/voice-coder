// eslint-disable-next-line @typescript-eslint/no-var-requires
const { install } = require("happy-dom");

// Provide a DOM-like environment for bun test
install({ url: "http://localhost:3000" });

// Polyfills / globals as needed
// Mock minimal WebSocket to avoid network in unit tests; tests can override
class MockWS {
  readyState = 0; // CONNECTING
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  onopen: (() => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(_url: string) {
    setTimeout(() => {
      this.readyState = MockWS.OPEN;
      this.onopen?.();
    }, 0);
  }
  addEventListener(type: string, cb: any) {
    if (type === "open") setTimeout(cb, 0);
  }
  send(_data: any) {}
  close() {
    this.readyState = MockWS.CLOSED;
    this.onclose?.();
  }
}
// @ts-ignore
globalThis.WebSocket = MockWS as any;
