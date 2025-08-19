import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { test, expect } from "bun:test";
import Home from "../app/page";

class ControlledWS {
  static readonly lastRef: { current: ControlledWS | null } = { current: null };
  readyState = 1; // OPEN
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
    ControlledWS.lastRef.current = this;
  }
  addEventListener(type: string, cb: any, opts?: any) {
    if (type === "open" && opts?.once) this.onopen = cb;
  }
  send(data: any) {
    this.sends.push(data);
  }
  close() {
    this.readyState = ControlledWS.CLOSED;
    this.onclose?.();
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
      ControlledWS.lastRef.current = null;
    });
};

test("WS open: sending text sends over WS and shows reply", async () => {
  await withWS(ControlledWS, async () => {
    render(<Home />);

    const input = screen.getByPlaceholderText(
      /type a message/i
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "hello" } });

    const sendBtn = screen.getByRole("button", { name: /send/i });
    fireEvent.click(sendBtn);

    const ws = ControlledWS.lastRef.current!;
    expect(ws.sends.length).toBe(1);

    // Server replies
    ws.onmessage?.({
      data: JSON.stringify({ type: "reply", id: "1", text: "ok" }),
    } as any);

    expect(await screen.findByText("hello")).toBeTruthy();
    expect(await screen.findByText("ok")).toBeTruthy();
  });
});
