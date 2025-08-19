import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import Home from "../app/page";

// Basic unit test: typing and sending adds user bubble
it("adds a user message when sending text", async () => {
  render(<Home />);

  const input = screen.getByPlaceholderText(/type a message/i) as HTMLInputElement;
  fireEvent.change(input, { target: { value: "hello" } });

  const sendBtn = screen.getByRole("button", { name: /send/i });
  fireEvent.click(sendBtn);

  expect(screen.getByText("hello")).toBeInTheDocument();
});
