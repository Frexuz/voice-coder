import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import { test, expect } from "bun:test";
import Home from "../app/page";

// Basic unit test: typing and sending adds user bubble
test("adds a user message when sending text", async () => {
  render(<Home />);

  const input = screen.getByPlaceholderText(/type a message/i) as HTMLInputElement;
  fireEvent.change(input, { target: { value: "hello" } });

  const sendBtn = screen.getByRole("button", { name: /send/i });
  fireEvent.click(sendBtn);

  expect(screen.getByText("hello")).toBeTruthy();
});
