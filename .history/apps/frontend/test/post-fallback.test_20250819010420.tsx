import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { test, expect } from "bun:test";
import Home from "../app/page";

class ClosedWS {
  readyState = 3; // CLOSED
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  addEventListener() {}
  send() { throw new Error('should not send'); }
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
    });
};

test("POST fallback used when WS closed", async () => {
  await withWS(ClosedWS, async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (_url: string, _init?: RequestInit) => {
      return new Response(JSON.stringify({ text: "server says hi" }), {
        headers: { "Content-Type": "application/json" },
      });
    } as any;

    render(<Home />);

    const input = screen.getByPlaceholderText(/type a message/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "fallback" } });

    const sendBtn = screen.getByRole("button", { name: /send/i });
    fireEvent.click(sendBtn);

    await waitFor(() => expect(screen.getByText("server says hi")).toBeTruthy());

    globalThis.fetch = originalFetch;
  });
});
