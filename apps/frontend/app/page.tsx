// apps/frontend/app/page.tsx

"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import "xterm/css/xterm.css";
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
  return `${proto}://${host}:4001/ws`;
}

export default function Home() {
  const [status, setStatus] = useState<Status>("idle");
  const [input, setInput] = useState<string>("");
  const wsRef = useRef<WebSocket | null>(null);
  const connectRef = useRef<(() => void) | null>(null);
  const [supportsSpeech, setSupportsSpeech] = useState<boolean>(false);
  type MinimalRecognition = Partial<{
    lang: string;
    interimResults: boolean;
    maxAlternatives: number;
    start: () => void;
    stop: () => void;
    onresult: (ev: unknown) => void;
    onnomatch: (ev?: unknown) => void;
    onerror: (ev?: unknown) => void;
    onend: (ev?: unknown) => void;
  }> | null;
  const recognitionRef = useRef<MinimalRecognition>(null);
  const gotSpeechRef = useRef<boolean>(false);
  const idRef = useRef<string>("");
  const [messages, setMessages] = useState<
    { id: string; role: "user" | "assistant"; text: string }[]
  >([]);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  // PTY session UI state
  const [showPty, setShowPty] = useState<boolean>(false);
  const [ptyRunning, setPtyRunning] = useState<boolean>(false);
  const [ptyOutput, setPtyOutput] = useState<string>("");
  const [summaryBullets, setSummaryBullets] = useState<string[]>([]);
  const ptyRef = useRef<HTMLDivElement | null>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const lastWrittenIndexRef = useRef<number>(0);
  const initialBufferRef = useRef<string>("");
  // If Start is clicked while WS is (re)connecting, queue it
  const pendingStartRef = useRef<boolean>(false);
  // Debug: WS status + last event
  const [wsStatus, setWsStatus] = useState<string>("disconnected");
  const [wsLastEvent, setWsLastEvent] = useState<string>("");
  // Phase 4: Approvals modal state
  const [pendingAction, setPendingAction] = useState<null | {
    actionId: string;
    reason: string;
    risks: string[];
    preview: string;
    timeoutMs?: number;
    createdAt: number;
  }>(null);

  // Send current terminal size to backend
  const sendResizeNow = useCallback(() => {
    const ws = wsRef.current;
    const term = xtermRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || !term) return;
    try {
      const cols = term.cols;
      const rows = term.rows;
      if (Number.isFinite(cols) && Number.isFinite(rows)) {
        ws.send(JSON.stringify({ type: "resize", cols, rows }));
      }
    } catch {}
  }, []);

  // Check for Web Speech API support
  useEffect(() => {
    setSupportsSpeech(
      typeof window !== "undefined" &&
        ("webkitSpeechRecognition" in window || "SpeechRecognition" in window)
    );
  }, []);

  // WebSocket setup: stable connection with simple auto-reconnect
  useEffect(() => {
    let alive = true;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

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
        // eslint-disable-next-line no-console
        console.log("[vc-fe] ws: connecting", url);
        setWsStatus("connecting");
        const socket = new WebSocket(url);
        wsRef.current = socket;

        socket.onopen = () => {
          // eslint-disable-next-line no-console
          console.log("[vc-fe] ws: open");
          setWsStatus("open");
          try {
            socket.send(JSON.stringify({ type: "hello" }));
          } catch {}
          // If user clicked Start during connect, send it now
          if (pendingStartRef.current) {
            try {
              socket.send(
                JSON.stringify({ type: "startSession", options: {} })
              );
              // eslint-disable-next-line no-console
              console.log("[vc-fe] startSession sent after open");
            } catch (e) {
              // eslint-disable-next-line no-console
              console.error("[vc-fe] startSession deferred send failed", e);
            } finally {
              pendingStartRef.current = false;
            }
          }
        };

        socket.onmessage = (event) => {
          if (!alive) return;
          try {
            const msg = JSON.parse(event.data);
            setWsLastEvent(String(msg?.type || ""));
            // eslint-disable-next-line no-console
            console.log("[vc-fe] ws: message", msg);
            if (msg.type === "ack") {
              setStatus("waiting");
            } else if (msg.type === "reply") {
              setStatus("done");
              setMessages((prev) => [
                ...prev,
                {
                  id: msg.id || Math.random().toString(36).slice(2),
                  role: "assistant",
                  text: msg.text,
                },
              ]);
            } else if (msg.type === "sessionStarted") {
              setPtyRunning(!!msg.running);
              setShowPty(true);
            } else if (msg.type === "output" || msg.type === "replyChunk") {
              // PTY output or non-PTY streaming chunks
              setPtyOutput((prev) => prev + String(msg.data || ""));
              setShowPty(true);
            } else if (msg.type === "summaryUpdate") {
              const arr = Array.isArray(msg?.summary?.bullets)
                ? (msg.summary.bullets as unknown[])
                : [];
              const bullets: string[] = arr
                .map((b) => (typeof b === "string" ? b : JSON.stringify(b)))
                .filter((s) => typeof s === "string" && s.length > 0);
              setSummaryBullets(bullets);
            } else if (msg.type === "actionRequest") {
              const risks: string[] = Array.isArray(msg?.risks)
                ? (msg.risks as string[])
                : [];
              setPendingAction({
                actionId: String(msg.actionId || ""),
                reason: String(msg.reason || "approval_required"),
                risks,
                preview: String(msg.preview || ""),
                timeoutMs: Number(msg.timeoutMs || 0) || undefined,
                createdAt: Date.now(),
              });
            } else if (msg.type === "actionResolved") {
              // Close modal on resolution
              setPendingAction(null);
            } else if (msg.type === "sessionExit") {
              setPtyRunning(false);
              setPtyOutput((prev) => prev + "\n[session exited]\n");
            } else if (msg.type === "error") {
              // Also mirror errors to console for easier debugging
              // eslint-disable-next-line no-console
              console.error("[vc-fe] ws: error", msg);
              setStatus("error");
              const text =
                msg.message ||
                (typeof msg.error === "string"
                  ? `Error: ${msg.error}`
                  : "Error");
              setMessages((prev) => [
                ...prev,
                {
                  id: msg.id || Math.random().toString(36).slice(2),
                  role: "assistant",
                  text,
                },
              ]);
            }
          } catch {
            // ignore malformed messages
          }
        };

        socket.onerror = () => {
          if (!alive) return;
          // eslint-disable-next-line no-console
          console.error("[vc-fe] ws: onerror");
          setStatus("error");
        };

        socket.onclose = () => {
          if (!alive) return;
          // eslint-disable-next-line no-console
          console.log("[vc-fe] ws: close");
          setWsStatus("closed");
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

    // expose connect for manual triggers
    connectRef.current = connect;

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
      connectRef.current = null;
    };
  }, []);

  // Auto-scroll to bottom when new messages arrive
  // Scroll chat on new message
  const lastMsgCountRef = useRef(0);
  useEffect(() => {
    if (messages.length !== lastMsgCountRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
      lastMsgCountRef.current = messages.length;
    }
  }, [messages]);

  // Keep a ref of current buffer for initial mount of xterm
  useEffect(() => {
    initialBufferRef.current = ptyOutput;
  }, [ptyOutput]);

  // xterm.js PTY output rendering + responsive fit
  useEffect(() => {
    if (!showPty) return;
    if (!ptyRef.current) return;
    if (!xtermRef.current) {
      const term = new Terminal({
        fontSize: 13,
        theme: { background: "#111", foreground: "#b6fcd5" },
        cursorBlink: false,
        disableStdin: true,
        scrollback: 1000,
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(ptyRef.current);
      try {
        fit.fit();
      } catch {}
      // Notify backend of size
      sendResizeNow();
      xtermRef.current = term;
      fitRef.current = fit;
      // Write any existing buffer (use ref to avoid hook deps)
      const initBuf = initialBufferRef.current;
      if (initBuf) {
        term.write(initBuf);
        lastWrittenIndexRef.current = initBuf.length;
      }
      // Observe container resize to refit terminal
      const ro = new ResizeObserver(() => {
        try {
          fitRef.current?.fit();
          sendResizeNow();
        } catch {}
      });
      ro.observe(ptyRef.current);
      const onResize = () => {
        try {
          fitRef.current?.fit();
          sendResizeNow();
        } catch {}
      };
      window.addEventListener("resize", onResize);
      return () => {
        window.removeEventListener("resize", onResize);
        try {
          ro.disconnect();
        } catch {}
        xtermRef.current?.dispose();
        xtermRef.current = null;
        fitRef.current = null;
        lastWrittenIndexRef.current = 0;
      };
    }
  }, [showPty, sendResizeNow]);

  // Append new PTY output to xterm without re-rendering
  useEffect(() => {
    const term = xtermRef.current;
    if (!term) return;
    const last = lastWrittenIndexRef.current;
    if (ptyOutput.length > last) {
      const chunk = ptyOutput.slice(last);
      term.write(chunk);
      lastWrittenIndexRef.current = ptyOutput.length;
    }
    // If output was cleared (e.g., Clear button), reset terminal
    if (ptyOutput.length === 0 && last > 0) {
      term.clear();
      lastWrittenIndexRef.current = 0;
    }
  }, [ptyOutput]);

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
    gotSpeechRef.current = false;
    recognition.onresult = (event: unknown) => {
      try {
        const ev = event as { results?: Array<Array<{ transcript?: string }>> };
        const text = ev?.results?.[0]?.[0]?.transcript || "";
        if (text.trim()) {
          gotSpeechRef.current = true;
          sendPrompt(text);
        }
      } catch {
        // ignore
      }
    };
    recognition.onnomatch = () => {
      // No speech recognized
    };
    recognition.onerror = () => setStatus("error");
    recognition.onend = () => {
      // If user released without speaking, return to idle
      if (!gotSpeechRef.current) {
        setStatus("idle");
      }
    };
    recognitionRef.current = recognition;
    recognition.start();
  };

  const handleMicUp = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
  };

  // Send prompt via WS or fallback to POST
  const sendPrompt = async (text: string) => {
    setStatus("sending");
    idRef.current = Math.random().toString(36).slice(2);
    // Add user message to chat
    setMessages((prev) => [...prev, { id: idRef.current, role: "user", text }]);
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "prompt", id: idRef.current, text }));
    } else if (ws && ws.readyState === WebSocket.CONNECTING) {
      const handler = () => {
        try {
          ws.send(JSON.stringify({ type: "prompt", id: idRef.current, text }));
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
        const data = (await res
          .json()
          .catch(() => ({}) as Record<string, unknown>)) as {
          text?: string;
          message?: string;
          error?: string;
        };
        if (res.ok && data?.text) {
          setStatus("done");
          setMessages((prev) => [
            ...prev,
            {
              id: Math.random().toString(36).slice(2),
              role: "assistant",
              text: data.text,
            },
          ]);
        } else {
          setStatus("error");
          const text = data?.message || data?.error || "Request failed";
          setMessages((prev) => [
            ...prev,
            {
              id: Math.random().toString(36).slice(2),
              role: "assistant",
              text: String(text),
            },
          ]);
        }
      } catch (e: unknown) {
        setStatus("error");
        setMessages((prev) => [
          ...prev,
          {
            id: Math.random().toString(36).slice(2),
            role: "assistant",
            text:
              e && typeof e === "object" && "message" in e
                ? String((e as { message?: string }).message || "Network error")
                : "Network error",
          },
        ]);
      }
    }
  };

  // Text input fallback
  const handleSend = () => {
    if (!input.trim()) return;
    sendPrompt(input);
    setInput("");
  };

  // Phase 4: Send approval decision
  const sendApproval = (approve: boolean) => {
    const ws = wsRef.current;
    const current = pendingAction;
    if (!current || !ws || ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(
        JSON.stringify({
          type: "actionResponse",
          actionId: current.actionId,
          approve,
        })
      );
    } catch {}
  };

  return (
    <main className="bg-gray-50 min-h-[100dvh]">
      {/* Phase 4: Approvals modal */}
      {pendingAction && (
        <div className="z-40 fixed inset-0 flex justify-center items-center bg-black/40 p-4">
          <div className="bg-white shadow-xl border rounded-lg w-full max-w-lg">
            <div className="px-4 py-3 border-b">
              <div className="font-semibold text-gray-900 text-base">
                Approval required
              </div>
              <div className="mt-0.5 text-gray-500 text-xs">
                {pendingAction.reason}
              </div>
            </div>
            <div className="space-y-3 p-4">
              {pendingAction.risks?.length ? (
                <div>
                  <div className="mb-1 font-medium text-gray-600 text-xs">
                    Risk markers
                  </div>
                  <ul className="pl-5 text-gray-700 text-sm list-disc">
                    {pendingAction.risks.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {pendingAction.preview ? (
                <div>
                  <div className="mb-1 font-medium text-gray-600 text-xs">
                    Preview
                  </div>
                  <pre className="bg-gray-50 p-2 border rounded max-h-48 overflow-auto text-xs whitespace-pre-wrap">
                    {pendingAction.preview}
                  </pre>
                </div>
              ) : null}
            </div>
            <div className="flex justify-end items-center gap-2 bg-gray-50 px-4 py-3 border-t">
              <button
                type="button"
                onClick={() => {
                  sendApproval(false);
                  // Optimistically clear; backend also sends actionResolved
                  setPendingAction(null);
                }}
                className="bg-white hover:bg-gray-100 px-3 py-1.5 border rounded text-sm"
              >
                Deny
              </button>
              <button
                type="button"
                onClick={() => sendApproval(true)}
                className="bg-blue-600 hover:opacity-90 px-3 py-1.5 border border-blue-600 rounded text-white text-sm"
              >
                Approve
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Chat container */}
      <div className="flex flex-col mx-auto max-w-md min-h-[100dvh]">
        {/* Header */}
        <div className="top-0 z-10 sticky bg-white/70 backdrop-blur px-4 py-3 border-b">
          <h1 className="font-semibold text-gray-900 text-lg text-center">
            Voice Coder
          </h1>
        </div>

        {/* Messages list */}
        <div className="pb-[calc(env(safe-area-inset-bottom)+180px)] flex-1 px-4 py-3 overflow-y-auto">
          {messages.length === 0 ? (
            <div className="mt-16 text-gray-500 text-sm text-center">
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
          {/* Minimal PTY panel */}
          <div className="mt-3">
            <div className="flex sm:flex-row flex-col sm:justify-between items-start sm:items-center gap-2 bg-white shadow-sm px-3 py-2 border rounded-md">
              <div className="font-medium text-gray-800 text-sm">
                PTY Session
              </div>
              <div className="flex sm:flex-row flex-wrap sm:justify-end items-center gap-2 w-full">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={
                      ptyRunning
                        ? "text-green-600 text-xs"
                        : "text-gray-500 text-xs"
                    }
                  >
                    {ptyRunning ? "running" : "stopped"}
                  </span>
                  <span className="max-w-[40vw] sm:max-w-[20rem] text-[10px] text-gray-400 truncate">
                    WS: {wsStatus}
                    {wsLastEvent ? ` • Last: ${wsLastEvent}` : ""}
                  </span>
                </div>
                <div className="flex items-center gap-2 pb-1 overflow-x-auto">
                  <button
                    type="button"
                    className="bg-gray-50 hover:bg-gray-100 px-2 py-1 border rounded text-xs shrink-0"
                    onClick={() => setShowPty((v) => !v)}
                  >
                    {showPty ? "Hide" : "Show"}
                  </button>
                  <button
                    type="button"
                    className="bg-gray-50 hover:bg-gray-100 disabled:opacity-50 px-2 py-1 border rounded text-xs shrink-0"
                    disabled={ptyRunning}
                    onClick={() => {
                      if (ptyRunning) return;
                      // eslint-disable-next-line no-console
                      console.log("[vc-fe] click: startSession");
                      const ws = wsRef.current;
                      // eslint-disable-next-line no-console
                      console.log("[vc-fe] wsRef", { has: !!ws });
                      if (!ws) {
                        // eslint-disable-next-line no-console
                        console.warn(
                          "[vc-fe] startSession: no websocket instance yet"
                        );
                        // Queue and let reconnect/open handler send it
                        pendingStartRef.current = true;
                        setWsStatus("connecting");
                        // Try to (re)connect immediately
                        connectRef.current?.();
                        return;
                      }
                      const rs = ws.readyState;
                      // eslint-disable-next-line no-console
                      console.log(
                        "[vc-fe] ws readyState",
                        rs,
                        "OPEN=",
                        WebSocket.OPEN
                      );
                      if (rs === WebSocket.OPEN) {
                        ws.send(
                          JSON.stringify({ type: "startSession", options: {} })
                        );
                      } else if (rs === WebSocket.CONNECTING) {
                        // Queue the start; onopen will send it
                        pendingStartRef.current = true;
                        setWsStatus("connecting");
                      } else if (
                        rs === WebSocket.CLOSING ||
                        rs === WebSocket.CLOSED
                      ) {
                        // Queue and trigger a reconnect
                        pendingStartRef.current = true;
                        setWsStatus("connecting");
                        connectRef.current?.();
                      } else {
                        // eslint-disable-next-line no-console
                        console.warn(
                          "[vc-fe] startSession: websocket not open",
                          rs
                        );
                        // Queue and rely on auto-reconnect to send on next open
                        pendingStartRef.current = true;
                        setWsStatus("connecting");
                        connectRef.current?.();
                      }
                    }}
                  >
                    Start
                  </button>
                  <button
                    type="button"
                    className="bg-gray-50 hover:bg-gray-100 disabled:opacity-50 px-2 py-1 border rounded text-xs shrink-0"
                    disabled={!ptyRunning}
                    onClick={() => {
                      // eslint-disable-next-line no-console
                      console.log("[vc-fe] click: interrupt");
                      const ws = wsRef.current;
                      if (ws && ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ type: "interrupt" }));
                      }
                    }}
                  >
                    Interrupt
                  </button>
                  <button
                    type="button"
                    className="bg-gray-50 hover:bg-gray-100 disabled:opacity-50 px-2 py-1 border rounded text-xs shrink-0"
                    disabled={!ptyRunning}
                    onClick={() => {
                      // eslint-disable-next-line no-console
                      console.log("[vc-fe] click: stop");
                      const ws = wsRef.current;
                      if (ws && ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ type: "stop" }));
                      }
                    }}
                  >
                    Stop
                  </button>
                  <button
                    type="button"
                    className="bg-gray-50 hover:bg-gray-100 px-2 py-1 border rounded text-xs shrink-0"
                    onClick={() => setPtyOutput("")}
                  >
                    Clear
                  </button>
                </div>
              </div>
            </div>
            {showPty && (
              <div className="gap-2 grid grid-cols-1 md:grid-cols-2 mt-2">
                <div className="bg-white border rounded-md overflow-hidden">
                  <div className="px-2 py-1 border-b font-semibold text-gray-600 text-xs">
                    Summary
                  </div>
                  <div className="px-3 py-2 text-gray-800 text-sm">
                    {summaryBullets.length === 0 ? (
                      <div className="text-gray-400 text-xs">
                        No summary yet…
                      </div>
                    ) : (
                      <ul className="pl-4 list-disc">
                        {summaryBullets.map((b) => (
                          <li key={b} className="mb-1">
                            {b}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
                <div className="bg-black border rounded-md overflow-hidden">
                  <div
                    ref={ptyRef}
                    style={{ height: "200px", width: "100%" }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Composer */}
        <div className="bottom-0 z-20 fixed inset-x-0 bg-white/90 backdrop-blur border-t">
          <div className="pb-[calc(env(safe-area-inset-bottom)+8px)] mx-auto px-4 pt-2 max-w-md">
            <div className="flex items-end gap-2">
              {/* Mic button */}
              <button
                type="button"
                className={
                  supportsSpeech
                    ? "flex h-14 w-14 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg active:scale-95 select-none touch-none"
                    : "flex h-14 w-14 items-center justify-center rounded-full bg-gray-400 text-white shadow-lg select-none touch-none"
                }
                onPointerDown={supportsSpeech ? handleMicDown : undefined}
                onPointerUp={supportsSpeech ? handleMicUp : undefined}
                onContextMenu={(e) => e.preventDefault()}
                disabled={!supportsSpeech}
                aria-label={supportsSpeech ? "Hold to Talk" : "Mic unavailable"}
              >
                <Mic size={28} />
              </button>

              {/* Text input */}
              <div className="flex flex-1 items-stretch bg-white shadow-sm border rounded-full min-h-14 overflow-hidden">
                <input
                  type="text"
                  className="flex-1 px-4 py-3 rounded-full outline-none w-full min-h-14 placeholder:text-gray-400"
                  placeholder={
                    supportsSpeech
                      ? "Type a message"
                      : "Type a message (mic unavailable)"
                  }
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  disabled={status === "listening"}
                  inputMode="text"
                  enterKeyHint="send"
                />
              </div>

              {/* Send button */}
              <button
                type="button"
                className="flex justify-center items-center bg-blue-600 disabled:bg-blue-300 shadow-lg rounded-full w-12 h-12 text-white active:scale-95 disabled:cursor-not-allowed"
                onClick={handleSend}
                disabled={!input.trim() || status === "listening"}
                aria-label="Send"
              >
                <Send size={22} />
              </button>
            </div>

            {/* Status row */}
            <div className="flex justify-center mt-2 text-gray-500 text-xs">
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
