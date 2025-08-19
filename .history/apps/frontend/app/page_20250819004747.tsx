// apps/frontend/app/page.tsx

"use client";

import { useRef, useState, useEffect } from "react";
import { Mic, Send } from "lucide-react";

type Status = "idle" | "listening" | "sending" | "waiting" | "done" | "error";

function getWSUrl() {
  if (typeof window === "undefined") return "";
  // Allow override via env for flexibility in different environments
  const override = process.env.NEXT_PUBLIC_BACKEND_WS_URL;
  if (override) return override;
  const host = window.location.hostname;
  const isSecure = window.location.protocol === "https:";
  const proto = isSecure ? "wss" : "ws";
  return `${proto}://${host}:4000/ws`;
}

export default function Home() {
  const [status, setStatus] = useState<Status>("idle");
  const [input, setInput] = useState<string>("");
  const wsRef = useRef<WebSocket | null>(null);
  const didInitRef = useRef(false);
  const [supportsSpeech, setSupportsSpeech] = useState<boolean>(false);
  const recognitionRef = useRef<any>(null);
  const idRef = useRef<string>("");
  const [messages, setMessages] = useState<{ id: string; role: "user" | "assistant"; text: string }[]>([]);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  // Check for Web Speech API support
  useEffect(() => {
    setSupportsSpeech(
      typeof window !== "undefined" &&
        ("webkitSpeechRecognition" in window || "SpeechRecognition" in window)
    );
  }, []);

  // WebSocket setup: stable connection with simple auto-reconnect
  useEffect(() => {
  if (didInitRef.current) return;
  didInitRef.current = true;
    let alive = true;
    let reconnectTimer: any;

    const connect = () => {
      if (!alive) return;
      const url = getWSUrl();
      try {
        // Reuse if already connecting/open
        const existing = wsRef.current;
        if (
          existing &&
          (existing.readyState === WebSocket.OPEN ||
            existing.readyState === WebSocket.CONNECTING)
        ) {
          return;
        }

        const socket = new WebSocket(url);
        wsRef.current = socket;

        socket.onopen = () => {
          try {
            socket.send(JSON.stringify({ type: "hello" }));
          } catch {}
        };

        socket.onmessage = (event) => {
          if (!alive) return;
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === "ack") {
              setStatus("waiting");
            } else if (msg.type === "reply") {
              setStatus("done");
              setMessages((prev) => [
                ...prev,
                { id: msg.id || Math.random().toString(36).slice(2), role: "assistant", text: msg.text },
              ]);
            } else if (msg.type === "error") {
              setStatus("error");
            }
          } catch {
            // ignore malformed messages
          }
        };

        socket.onerror = () => {
          if (!alive) return;
          setStatus("error");
        };

        socket.onclose = () => {
          if (!alive) return;
          wsRef.current = null;
          // attempt a lightweight reconnect in dev/if backend restarts
          clearTimeout(reconnectTimer);
          reconnectTimer = setTimeout(connect, 300);
        };
      } catch {
        // schedule retry if constructor fails
        reconnectTimer = setTimeout(connect, 500);
      }
    };

    connect();

    return () => {
      alive = false;
      clearTimeout(reconnectTimer);
      // Avoid closing while CONNECTING to prevent noisy console errors in dev
      try {
        const s = wsRef.current;
        if (s && s.readyState === WebSocket.OPEN) {
          s.close(1000, "unmount");
        }
      } catch {}
      wsRef.current = null;
    };
  }, []);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // SpeechRecognition handlers
  const handleMicDown = () => {
    if (!supportsSpeech) return;
    setStatus("listening");
    idRef.current = Math.random().toString(36).slice(2);
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event: any) => {
      const text = event.results[0][0].transcript;
      sendPrompt(text);
    };
    recognition.onerror = () => setStatus("error");
    recognitionRef.current = recognition;
    recognition.start();
  };

  const handleMicUp = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      setStatus("sending");
    }
  };

  // Send prompt via WS or fallback to POST
  const sendPrompt = async (text: string) => {
    setStatus("sending");
    idRef.current = Math.random().toString(36).slice(2);
    // Add user message to chat
    setMessages((prev) => [
      ...prev,
      { id: idRef.current, role: "user", text },
    ]);
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "prompt", id: idRef.current, text }));
    } else if (ws && ws.readyState === WebSocket.CONNECTING) {
      const handler = () => {
        try {
          ws.send(
            JSON.stringify({ type: "prompt", id: idRef.current, text })
          );
        } catch {
          // ignore and let fallback below handle if needed
        }
      };
      ws.addEventListener("open", handler, { once: true });
    } else {
      // Fallback to POST
      try {
        const res = await fetch("/api/prompt", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
  const data = await res.json();
        setStatus("done");
        setMessages((prev) => [
          ...prev,
          { id: Math.random().toString(36).slice(2), role: "assistant", text: data.text },
        ]);
      } catch {
        setStatus("error");
      }
    }
  };

  // Text input fallback
  const handleSend = () => {
    if (!input.trim()) return;
    sendPrompt(input);
    setInput("");
  };

  return (
    <main className="min-h-[100dvh] bg-gray-50">
      {/* Chat container */}
      <div className="mx-auto flex min-h-[100dvh] max-w-md flex-col">
        {/* Header */}
        <div className="sticky top-0 z-10 border-b bg-white/70 px-4 py-3 backdrop-blur">
          <h1 className="text-center text-lg font-semibold text-gray-900">Voice Coder</h1>
        </div>

        {/* Messages list */}
        <div className="flex-1 overflow-y-auto px-4 py-3 pb-[calc(env(safe-area-inset-bottom)+96px)]">
          {messages.length === 0 ? (
            <div className="mt-16 text-center text-sm text-gray-500">
              Say something or type a message to get started.
            </div>
          ) : (
            <div className="flex flex-col gap-2">
        {messages.map((m) => (
                <div
          key={m.id}
                  className={
                    m.role === "user"
                      ? "ml-10 self-end max-w-[80%] rounded-2xl rounded-br-sm bg-blue-600 px-3 py-2 text-white shadow"
                      : "mr-10 self-start max-w-[80%] rounded-2xl rounded-bl-sm bg-white px-3 py-2 text-gray-900 shadow"
                  }
                >
                  {m.text}
                </div>
              ))}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        {/* Composer */}
        <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-white/90 backdrop-blur">
          <div className="mx-auto max-w-md px-4 pt-2 pb-[calc(env(safe-area-inset-bottom)+8px)]">
            <div className="flex items-end gap-2">
              {/* Mic button */}
              <button
                className={
                  supportsSpeech
                    ? "flex h-14 w-14 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg active:scale-95"
                    : "flex h-14 w-14 items-center justify-center rounded-full bg-gray-400 text-white shadow-lg"
                }
                onPointerDown={supportsSpeech ? handleMicDown : undefined}
                onPointerUp={supportsSpeech ? handleMicUp : undefined}
                disabled={!supportsSpeech}
                aria-label={supportsSpeech ? "Hold to Talk" : "Mic unavailable"}
              >
                <Mic size={28} />
              </button>

              {/* Text input */}
              <div className="flex min-h-14 flex-1 items-stretch overflow-hidden rounded-full border bg-white shadow-sm">
                <input
                  type="text"
                  className="min-h-14 w-full flex-1 rounded-full px-4 py-3 outline-none placeholder:text-gray-400"
                  placeholder={supportsSpeech ? "Type a message" : "Type a message (mic unavailable)"}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  disabled={status === "listening"}
                  inputMode="text"
                  enterKeyHint="send"
                />
              </div>

              {/* Send button */}
              <button
                className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg active:scale-95 disabled:cursor-not-allowed disabled:bg-blue-300"
                onClick={handleSend}
                disabled={!input.trim() || status === "listening"}
                aria-label="Send"
              >
                <Send size={22} />
              </button>
            </div>

            {/* Status row */}
            <div className="mt-2 flex justify-center text-xs text-gray-500">
              {
                {
                  idle: "Idle",
                  listening: "Listening… (hold the mic)",
                  sending: "Sending…",
                  waiting: "Waiting…",
                  done: "",
                  error: "Error",
                }[status]
              }
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
