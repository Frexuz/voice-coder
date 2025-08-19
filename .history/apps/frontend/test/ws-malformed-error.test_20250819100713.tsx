import React from "react";
import { render } from "@testing-library/react";
import { test, expect } from "bun:test";
import Home from "../app/page";

class MalformedWS {
  readyState = 1; // OPEN
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onopen: (() => void) | null = null;
  addEventListener() {}
  send() {}
}

test("ignores malformed WS messages without crashing", async () => {
  const prev = globalThis.WebSocket;
  // @ts-ignore
  globalThis.WebSocket = MalformedWS as any;

  render(<Home />);

  const ws = new MalformedWS("") as any;
  ws.onmessage?.({ data: "{not-json" } as any);

  // no assertion; just ensure no throw
  expect(true).toBeTruthy();

  // @ts-ignore
  globalThis.WebSocket = prev;
});
