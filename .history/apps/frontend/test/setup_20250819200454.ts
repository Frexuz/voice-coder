import { Window } from 'happy-dom';
import { cleanup } from '@testing-library/react';

// Register a DOM-like environment for bun test globally using happy-dom Window
const win = new Window({ url: 'http://localhost:3000' });
// Basic globals
// @ts-ignore
globalThis.window = win as any;
// @ts-ignore
globalThis.document = win.document as any;
// @ts-ignore
globalThis.navigator = win.navigator as any;
// Common constructors and fns used by React/RTL
// @ts-ignore
globalThis.HTMLElement = win.HTMLElement as any;
// @ts-ignore
globalThis.Node = win.Node as any;
// @ts-ignore
globalThis.Text = win.Text as any;
// @ts-ignore
globalThis.CustomEvent = win.CustomEvent as any;
// @ts-ignore
globalThis.getComputedStyle = win.getComputedStyle.bind(win) as any;
// @ts-ignore
globalThis.requestAnimationFrame = win.requestAnimationFrame.bind(win) as any;
// @ts-ignore
globalThis.cancelAnimationFrame = win.cancelAnimationFrame.bind(win) as any;

// Ensure RTL cleans up between tests to avoid duplicate elements across renders
// Use global hook if provided by the test runner
// @ts-ignore
(globalThis.afterEach ?? (() => {}))(() => {
  try { cleanup(); } catch {}
});

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
