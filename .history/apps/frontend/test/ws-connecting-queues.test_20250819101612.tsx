import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { test, expect } from "bun:test";
import Home from "../app/page";

class ConnectingWS {
  static readonly lastRef: { current: ConnectingWS | null } = { current: null };
  readyState = 0; // CONNECTING
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  sends: any[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(_url: string) {
    ConnectingWS.lastRef.current = this;
  }
  addEventListener(type: string, cb: any, opts?: any) {
    if (type === "open" && opts?.once) this.onopen = cb;
  }
  send(data: any) {
    this.sends.push(data);
  }
  openNow() {
    this.readyState = ConnectingWS.OPEN;
    this.onopen?.();
  }
}

const withWS = (Cls: any, fn: () => void | Promise<void>) => {
  const prev = globalThis.WebSocket;
  // @ts-ignore
  globalThis.WebSocket = Cls;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      // @ts-ignore
      globalThis.WebSocket = prev;
      ConnectingWS.lastRef.current = null;
    });
};

test("WS connecting: queues send until open", async () => {
  await withWS(ConnectingWS, async () => {
    render(<Home />);

    const input = screen.getByPlaceholderText(
      /type a message/i
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "queued" } });

    const sendBtn = screen.getByRole("button", { name: /send/i });
    fireEvent.click(sendBtn);

    const ws = ConnectingWS.lastRef.current!;
    // nothing sent yet because CONNECTING
    expect(ws.sends.length).toBe(0);

    // When socket opens, the queued message is sent
    ws.openNow();
    expect(ws.sends.length).toBe(1);
  });
});
