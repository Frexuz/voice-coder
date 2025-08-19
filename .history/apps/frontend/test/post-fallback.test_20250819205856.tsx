import React from "react";
import { render, fireEvent } from "@testing-library/react";
import { test, expect } from "bun:test";
import Home from "../app/page";

class ClosedWS {
  readyState = 3; // CLOSED
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  addEventListener() {}
  send() {
    throw new Error("should not send");
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
    });
};

test("POST fallback used when WS closed", async () => {
  await withWS(ClosedWS, async () => {
    const originalFetch = globalThis.fetch;
    // @ts-ignore - override for test
    globalThis.fetch = (async (
      _input: RequestInfo | URL,
      _init?: RequestInit
    ) => {
      return new Response(JSON.stringify({ text: "server says hi" }), {
        headers: { "Content-Type": "application/json" },
      });
    }) as any;

    const { getByPlaceholderText, getByRole, findByText } = render(<Home />);

    const input = getByPlaceholderText(/type a message/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "fallback" } });

    const sendBtn = getByRole("button", { name: /send/i });
    fireEvent.click(sendBtn);

    expect(await findByText("server says hi")).toBeTruthy();

    // @ts-ignore - restore
    globalThis.fetch = originalFetch;
  });
});
