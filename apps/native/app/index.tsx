import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
  Keyboard,
} from "react-native";
import Animated, {
  Easing,
  useAnimatedKeyboard,
  useAnimatedStyle,
  withTiming,
} from "react-native-reanimated";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import type { ChatMessage } from "@/components/ChatBubbles";
import ChatBubbles from "@/components/ChatBubbles";
import ComposerBar from "@/components/ComposerBar";
import TerminalPanel from "@/components/TerminalPanel";
import useSpeech from "@/hooks/useSpeech.native";

type Status = "idle" | "listening" | "sending" | "waiting" | "done" | "error";

function safeToString(v: unknown): string {
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function isString(x: unknown): x is string {
  return typeof x === "string";
}

function toStringArray(arr: unknown[]): string[] {
  return arr.map((b) => (typeof b === "string" ? b : JSON.stringify(b)));
}

function getWSUrl(): string {
  if (Platform.OS === "web") {
    const win = typeof window !== "undefined" ? window : undefined;
    if (!win) return "";
    const override =
      (process.env?.EXPO_PUBLIC_BACKEND_WS_URL as unknown as
        | string
        | undefined) ||
      (process.env?.NEXT_PUBLIC_BACKEND_WS_URL as unknown as
        | string
        | undefined);
    if (override) return override;
    const host = win.location.hostname;
    const isSecure = win.location.protocol === "https:";
    const proto = isSecure ? "wss" : "ws";
    return `${proto}://${host}:4001/ws`;
  }
  const override = process.env?.EXPO_PUBLIC_BACKEND_WS_URL as unknown as
    | string
    | undefined;
  if (override) return override;
  // const host = Platform.OS === "android" ? "10.0.2.2" : "localhost";
  const host = "192.168.0.100";
  return `ws://${host}:4001/ws`;
}

function getHTTPBase(): string {
  if (Platform.OS === "web") {
    const win = typeof window !== "undefined" ? window : undefined;
    if (!win) return "";
    const override =
      (process.env?.EXPO_PUBLIC_BACKEND_HTTP_URL as unknown as
        | string
        | undefined) ||
      (process.env?.NEXT_PUBLIC_BACKEND_HTTP_URL as unknown as
        | string
        | undefined);
    if (override) return override;
    const host = win.location.hostname;
    const proto = win.location.protocol;
    return `${proto}//${host}:4001`;
  }
  const override = process.env?.EXPO_PUBLIC_BACKEND_HTTP_URL as unknown as
    | string
    | undefined;
  if (override) return override;
  // const host = Platform.OS === "android" ? "10.0.2.2" : "localhost";
  const host = "192.168.0.100";
  return `http://${host}:4001`;
}

// Strip ANSI escape sequences and normalize carriage returns for display
// sanitizeAnsi previously used for terminal panel; unused in chat flow now

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const [status, setStatus] = useState<Status>("idle");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // Track the current assistant summary bubble id (if any)
  const summaryMsgIdRef = useRef<string | null>(null);
  // Track the current approval bubble id (user-side)
  const approvalMsgIdRef = useRef<string | null>(null);
  // Unique message id generator (monotonic within session)
  const idPrefixRef = useRef<string>(Math.random().toString(36).slice(2));
  const idSeqRef = useRef<number>(0);
  const newMsgIdRef = useRef<() => string>(() => "");
  newMsgIdRef.current = () => {
    idSeqRef.current += 1;
    return `m-${idPrefixRef.current}-${idSeqRef.current}`;
  };
  const newMsgId = () => newMsgIdRef.current();
  const [ptyRunning, setPtyRunning] = useState(false);
  const [showPty, setShowPty] = useState(false);
  const [ptyOutput, setPtyOutput] = useState("");
  const [summaryBullets, setSummaryBullets] = useState<string[]>([]);
  const [summaryObj, setSummaryObj] = useState<null | {
    version?: string;
    bullets?: string[];
    filesChanged?: { path: string; adds?: number; dels?: number }[];
    tests?: {
      passed?: number;
      failed?: number;
      failures?: { name?: string; message?: string }[];
    };
    errors?: { type?: string; message?: string }[];
    actions?: string[];
    metrics?: { durationMs?: number; commandsRun?: number; exitCode?: number };
  }>(null);
  const [wsStatus, setWsStatus] = useState("disconnected");
  const [wsLastEvent, setWsLastEvent] = useState("");
  const [health, setHealth] = useState<null | {
    engine?: string;
    ok?: boolean;
    server?: boolean;
    model?: string;
    hasModel?: boolean;
    error?: string;
  }>(null);
  const [isSummarizing, setIsSummarizing] = useState(false);
  // Phase 4: Approvals modal state
  const [pendingAction, setPendingAction] = useState<null | {
    actionId: string;
    reason: string;
    risks: string[];
    preview: string;
    timeoutMs?: number;
    createdAt: number;
  }>(null);
  const pendingActionRef = useRef<typeof pendingAction>(null);
  useEffect(() => {
    pendingActionRef.current = pendingAction;
  }, [pendingAction]);
  const messagesScrollRef = useRef<ScrollView | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const connectRef = useRef<(() => void) | null>(null);
  const pendingStartRef = useRef(false);
  console.log({ pendingAction });
  const speech = useSpeech((t: string) => {
    void sendPrompt(t);
  });

  // Optional: handle speech.error if you want to surface it in UI

  // When approval modal opens, dismiss the OS keyboard for a clean UX
  useEffect(() => {
    if (pendingAction) {
      try {
        Keyboard.dismiss();
      } catch {}
    }
  }, [pendingAction]);

  useEffect(() => {
    let alive = true;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      if (!alive) return;
      try {
        const existing = wsRef.current;
        if (
          existing &&
          (existing.readyState === WebSocket.OPEN ||
            existing.readyState === WebSocket.CONNECTING)
        )
          return;
        const url = getWSUrl();
        setWsStatus("connecting");
        const socket = new WebSocket(url);
        wsRef.current = socket;

        socket.onopen = () => {
          setWsStatus("open");
          try {
            socket.send(JSON.stringify({ type: "hello" }));
          } catch {}
          // Fetch summarizer health on open
          try {
            const base = getHTTPBase();
            if (base) {
              fetch(`${base}/api/summarizer/health`)
                .then((r) => r.json())
                .then((j) => setHealth(j))
                .catch(() => setHealth({ ok: false }));
            }
          } catch {
            setHealth({ ok: false });
          }
          if (pendingStartRef.current) {
            try {
              socket.send(
                JSON.stringify({ type: "startSession", options: {} })
              );
            } catch {}
            pendingStartRef.current = false;
          }
        };
        socket.onmessage = (event: MessageEvent) => {
          if (!alive) return;
          try {
            const data = event.data;
            const rawUnknown: unknown =
              typeof data === "string" ? JSON.parse(data) : data;
            const rawObj: Record<string, unknown> =
              rawUnknown && typeof rawUnknown === "object"
                ? (rawUnknown as Record<string, unknown>)
                : {};
            const type = typeof rawObj.type === "string" ? rawObj.type : "";
            setWsLastEvent(String(type));
            switch (type) {
              case "ack":
                setStatus("waiting");
                break;
              case "summaryStatus": {
                const running = Boolean(rawObj.running);
                setIsSummarizing(running);
                if (running) {
                  // Don't show spinner until after approval has been decided
                  if (pendingActionRef.current) {
                    break;
                  }
                  // Insert a pending assistant bubble (or keep existing pending one).
                  // If an old id exists but points to a resolved message, create a new one.
                  setMessages((prev) => {
                    const curId = summaryMsgIdRef.current;
                    if (curId) {
                      const idx = prev.findIndex((m) => m.id === curId);
                      if (idx !== -1) {
                        const cur = prev[idx];
                        if (
                          cur.pending ||
                          !cur.text ||
                          cur.text.trim().length === 0
                        ) {
                          const next = [...prev];
                          next[idx] = { ...cur, pending: true };
                          return next;
                        }
                        // Existing bubble already resolved with content; start a fresh one
                      }
                    }
                    const id = newMsgIdRef.current();
                    summaryMsgIdRef.current = id;
                    return [
                      ...prev,
                      { id, role: "assistant", text: "", pending: true },
                    ];
                  });
                } else {
                  // Summarization completed. If we still have a pending bubble and no content was set,
                  // finalize it by copying the last assistant message if available (so duplicate answers show),
                  // otherwise use a neutral placeholder.
                  setMessages((prev) => {
                    const id = summaryMsgIdRef.current;
                    if (!id) return prev;
                    const idx = prev.findIndex((m) => m.id === id);
                    if (idx === -1) return prev;
                    const msg = prev[idx];
                    if (!msg.pending) return prev; // already resolved by summaryUpdate
                    let text = (msg.text || "").trim();
                    if (!text) {
                      // find last non-pending assistant message before this one
                      let prior = "";
                      for (let i = idx - 1; i >= 0; i--) {
                        const m = prev[i];
                        if (
                          m.role === "assistant" &&
                          !m.pending &&
                          m.id !== id
                        ) {
                          const t = (m.text || "").trim();
                          if (t) {
                            prior = t;
                            break;
                          }
                        }
                      }
                      text = prior || "(no changes)";
                    }
                    const next = [...prev];
                    next[idx] = { ...msg, pending: false, text };
                    return next;
                  });
                }
                break;
              }

              case "reply": {
                setStatus("done");
                // If a summary bubble is active, keep spinner and wait for summaryUpdate/summaryFinal.
                if (!summaryMsgIdRef.current) {
                  const replyText = safeToString(rawObj.text);
                  const replyId =
                    (typeof rawObj.id === "string" ? rawObj.id : undefined) ||
                    newMsgId();
                  setMessages((prev) => [
                    ...prev,
                    { id: replyId, role: "assistant", text: replyText },
                  ]);
                }
                break;
              }
              case "summaryUpdate": {
                const s = rawObj.summary;
                if (s && typeof s === "object") {
                  setSummaryObj(s as typeof summaryObj);
                  const bullets = (s as Record<string, unknown>).bullets;
                  const arr = Array.isArray(bullets)
                    ? (bullets as unknown[])
                    : [];
                  setSummaryBullets(
                    toStringArray(arr).filter((v) => v.length > 0)
                  );
                  // Render/update summary in chat bubble
                  let text = toStringArray(arr)
                    .filter((v) => v.length > 0)
                    .map((b) => `• ${b}`)
                    .join("\n");
                  if (!text) {
                    // Fallback: synthesize a compact summary from tests/files/errors
                    const lines: string[] = [];
                    const sObj = s as typeof summaryObj;
                    if (
                      sObj?.tests &&
                      (sObj.tests.passed || sObj.tests.failed)
                    ) {
                      lines.push(
                        `Tests: ${sObj.tests.passed ?? 0}✓/${sObj.tests.failed ?? 0}✗`
                      );
                    }
                    if (
                      Array.isArray(sObj?.filesChanged) &&
                      sObj.filesChanged.length > 0
                    ) {
                      lines.push(`Files changed: ${sObj.filesChanged.length}`);
                    }
                    if (Array.isArray(sObj?.errors) && sObj.errors.length > 0) {
                      const first = sObj.errors[0];
                      lines.push(
                        `Errors: ${sObj.errors.length}${first?.message ? ` — ${first.message}` : ""}`
                      );
                    }
                    text = lines.join("\n");
                    if (!text) text = "(no summary details)";
                  }
                  setMessages((prev) => {
                    const id = summaryMsgIdRef.current || newMsgIdRef.current();
                    summaryMsgIdRef.current = id;
                    const exists = prev.some((m) => m.id === id);
                    const headerChip =
                      health?.engine === "llm" && health?.model
                        ? health.model
                        : undefined;
                    if (exists) {
                      return prev.map((m) =>
                        m.id === id
                          ? { ...m, pending: false, text, headerChip }
                          : m
                      );
                    }
                    return [
                      ...prev,
                      {
                        id,
                        role: "assistant",
                        text,
                        pending: false,
                        headerChip,
                      },
                    ];
                  });
                } else {
                  setSummaryObj(null);
                  const summaryMaybe = (rawObj as Record<string, unknown>)
                    .summary as { bullets?: unknown[] } | undefined;
                  const arr = Array.isArray(summaryMaybe?.bullets)
                    ? summaryMaybe?.bullets || []
                    : [];
                  setSummaryBullets(
                    toStringArray(arr).filter((v) => v.length > 0)
                  );
                }
                break;
              }
              case "summaryFinal": {
                const s = rawObj.summary as typeof summaryObj;
                if (s && typeof s === "object") {
                  setSummaryObj(s);
                  type SummaryMetrics = { model?: string; durationMs?: number };
                  const metrics: SummaryMetrics | undefined = (
                    s as { metrics?: SummaryMetrics }
                  ).metrics;
                  const bullets = (s as Record<string, unknown>).bullets;
                  const arr = Array.isArray(bullets)
                    ? (bullets as unknown[])
                    : [];
                  const bulletLines = toStringArray(arr).filter(
                    (v) => v.length > 0
                  );
                  setSummaryBullets(bulletLines);
                  let text = bulletLines.map((b) => `• ${b}`).join("\n");
                  if (!text) {
                    const lines: string[] = [];
                    const sObj = s as typeof summaryObj;
                    if (
                      sObj?.tests &&
                      (sObj.tests.passed || sObj.tests.failed)
                    ) {
                      lines.push(
                        `Tests: ${sObj.tests.passed ?? 0}✓/${sObj.tests.failed ?? 0}✗`
                      );
                    }
                    if (
                      Array.isArray(sObj?.filesChanged) &&
                      sObj.filesChanged.length > 0
                    ) {
                      lines.push(`Files changed: ${sObj.filesChanged.length}`);
                    }
                    if (Array.isArray(sObj?.errors) && sObj.errors.length > 0) {
                      const first = sObj.errors[0];
                      lines.push(
                        `Errors: ${sObj.errors.length}${first?.message ? ` — ${first.message}` : ""}`
                      );
                    }
                    text = lines.join("\n");
                    if (!text) text = "(no summary details)";
                  }
                  setMessages((prev) => {
                    const id = summaryMsgIdRef.current || newMsgIdRef.current();
                    summaryMsgIdRef.current = id;
                    const exists = prev.some((m) => m.id === id);
                    const headerChip = metrics?.model
                      ? metrics.model
                      : health?.engine
                        ? String(health.engine)
                        : undefined;
                    const footer = Number.isFinite(Number(metrics?.durationMs))
                      ? `${Math.round(Number(metrics?.durationMs))} ms`
                      : undefined;
                    // Add expansion chips based on summary details
                    const expansions: {
                      kind: "diff" | "first-failure" | "last-error";
                      label: string;
                    }[] = [];
                    const sObj = s as typeof summaryObj;
                    if (
                      Array.isArray(sObj?.filesChanged) &&
                      sObj.filesChanged.length > 0
                    ) {
                      expansions.push({ kind: "diff", label: "View diff" });
                    }
                    const failedCount = sObj?.tests?.failed ?? 0;
                    const failuresArr = Array.isArray(sObj?.tests?.failures)
                      ? (sObj?.tests?.failures as unknown[])
                      : [];
                    if (failedCount > 0 || failuresArr.length > 0) {
                      expansions.push({
                        kind: "first-failure",
                        label: "Show first failure",
                      });
                    }
                    if (Array.isArray(sObj?.errors) && sObj.errors.length > 0) {
                      expansions.push({
                        kind: "last-error",
                        label: "Show last error",
                      });
                    }
                    const patch = {
                      pending: false,
                      text,
                      headerChip,
                      footer,
                      expansions: expansions.length ? expansions : undefined,
                    } as const;
                    if (exists) {
                      return prev.map((m) =>
                        m.id === id ? { ...m, ...patch } : m
                      );
                    }
                    return [...prev, { id, role: "assistant", ...patch }];
                  });
                }
                break;
              }
              case "expandResponse": {
                const ok = Boolean(rawObj.ok);
                const content = isString(
                  (rawObj as { content?: unknown }).content
                )
                  ? String((rawObj as { content?: unknown }).content)
                  : "";
                const title = isString((rawObj as { title?: unknown }).title)
                  ? String((rawObj as { title?: unknown }).title)
                  : undefined;
                const kind = isString((rawObj as { kind?: unknown }).kind)
                  ? String((rawObj as { kind?: unknown }).kind)
                  : undefined;
                if (!ok) {
                  const msg = isString(
                    (rawObj as { message?: unknown }).message
                  )
                    ? String((rawObj as { message?: unknown }).message)
                    : "No content";
                  setMessages((prev) => [
                    ...prev,
                    { id: newMsgId(), role: "assistant", text: msg },
                  ]);
                  break;
                }
                const label = title || (kind ? `Slice: ${kind}` : undefined);
                const id = newMsgId();
                setMessages((prev) => [
                  ...prev,
                  {
                    id,
                    role: "assistant",
                    text: content || "(empty)",
                    mono: true,
                    headerChip: label,
                  },
                ]);
                break;
              }
              case "sessionExit":
                setPtyRunning(false);
                setPtyOutput((prev) => prev + "\n[session exited]\n");
                break;
              case "error": {
                setStatus("error");
                const text =
                  (typeof rawObj.message === "string"
                    ? String(rawObj.message)
                    : undefined) ||
                  (typeof rawObj.error === "string"
                    ? `Error: ${String(rawObj.error)}`
                    : "Error");
                setMessages((prev) => [
                  ...prev,
                  { id: newMsgId(), role: "assistant", text },
                ]);
                break;
              }
              case "actionRequest": {
                const risks: string[] = Array.isArray(rawObj?.risks)
                  ? (rawObj.risks as string[])
                  : [];
                const nextPending = {
                  actionId:
                    typeof rawObj.actionId === "string"
                      ? String(rawObj.actionId)
                      : "",
                  reason:
                    typeof rawObj.reason === "string"
                      ? String(rawObj.reason)
                      : "approval_required",
                  risks,
                  preview: safeToString(rawObj.preview ?? ""),
                  timeoutMs:
                    typeof rawObj.timeoutMs === "number"
                      ? Number(rawObj.timeoutMs)
                      : undefined,
                  createdAt: Date.now(),
                };
                setPendingAction(nextPending);
                // Render approval bubble on the right (user)
                const id = newMsgIdRef.current();
                approvalMsgIdRef.current = id;
                const lines: string[] = [
                  `Approval required: ${nextPending.reason}`,
                ];
                if (nextPending.risks?.length) {
                  lines.push(`Risks: ${nextPending.risks.join(", ")}`);
                }
                const text = lines.join("\n");
                setMessages((prev) => [
                  ...prev,
                  {
                    id,
                    role: "user",
                    text,
                    actions: {
                      approveLabel: "Approve",
                      denyLabel: "Deny",
                      onApprove: () => {
                        // Optimistically update bubble to remove actions
                        setMessages((prev2) =>
                          prev2.map((m) =>
                            m.id === id
                              ? {
                                  ...m,
                                  actions: null,
                                  text: `${text}\n— Approved`,
                                }
                              : m
                          )
                        );
                        // Send approval
                        const ws = wsRef.current;
                        if (
                          ws &&
                          ws.readyState === WebSocket.OPEN &&
                          nextPending.actionId
                        ) {
                          try {
                            ws.send(
                              JSON.stringify({
                                type: "actionResponse",
                                actionId: nextPending.actionId,
                                approve: true,
                              })
                            );
                          } catch {}
                        }
                        // Ensure a pending assistant bubble is visible immediately after approval
                        setMessages((prev3) => {
                          const curId = summaryMsgIdRef.current;
                          if (curId) {
                            const idx = prev3.findIndex((m) => m.id === curId);
                            if (idx !== -1) {
                              const cur = prev3[idx];
                              if (cur.pending) return prev3;
                              const next = [...prev3];
                              next[idx] = { ...cur, pending: true };
                              return next;
                            }
                          }
                          const newId = newMsgIdRef.current();
                          summaryMsgIdRef.current = newId;
                          return [
                            ...prev3,
                            {
                              id: newId,
                              role: "assistant",
                              text: "",
                              pending: true,
                            },
                          ];
                        });
                      },
                      onDeny: () => {
                        setMessages((prev2) =>
                          prev2.map((m) =>
                            m.id === id
                              ? {
                                  ...m,
                                  actions: null,
                                  text: `${text}\n— Denied`,
                                }
                              : m
                          )
                        );
                        const ws = wsRef.current;
                        if (
                          ws &&
                          ws.readyState === WebSocket.OPEN &&
                          nextPending.actionId
                        ) {
                          try {
                            ws.send(
                              JSON.stringify({
                                type: "actionResponse",
                                actionId: nextPending.actionId,
                                approve: false,
                              })
                            );
                          } catch {}
                        }
                      },
                    },
                  },
                ]);
                break;
              }
              case "actionResolved":
                setPendingAction(null);
                break;
              default:
                break;
            }
          } catch {}
        };
        socket.onerror = () => {
          if (!alive) return;
          setStatus("error");
        };
        socket.onclose = () => {
          if (!alive) return;
          setWsStatus("closed");
          wsRef.current = null;
          if (reconnectTimer) clearTimeout(reconnectTimer);
          reconnectTimer = setTimeout(connect, 500);
        };
      } catch {
        reconnectTimer = setTimeout(connect, 500);
      }
    };

    connectRef.current = connect;
    connect();

    return () => {
      alive = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      try {
        const s = wsRef.current;
        if (s && s.readyState === WebSocket.OPEN) s.close(1000);
      } catch {}
      wsRef.current = null;
      connectRef.current = null;
    };
  }, []);

  const lastCountRef = useRef(0);

  useEffect(() => {
    if (messages.length !== lastCountRef.current) {
      lastCountRef.current = messages.length;
      // Auto-scroll chat to bottom on new message
      requestAnimationFrame(() => {
        messagesScrollRef.current?.scrollToEnd({ animated: true });
      });
    }
  }, [messages]);

  const sendPrompt = useCallback(async (text: string) => {
    setStatus("sending");
    const id = newMsgIdRef.current();
    setMessages((prev) => [...prev, { id, role: "user", text }]);
    // New user turn: ensure a fresh assistant bubble will be created
    summaryMsgIdRef.current = null;

    const ws = wsRef.current;

    const sendViaWS = (s: WebSocket) => {
      try {
        s.send(JSON.stringify({ type: "prompt", id, text }));
      } catch {}
    };

    const fallbackPost = async () => {
      try {
        const base = getHTTPBase();
        const res = await fetch(`${base}/api/prompt`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
        const data: unknown = await res.json().catch(() => ({}));
        const obj =
          data && typeof data === "object"
            ? (data as Record<string, unknown>)
            : {};
        if (res.ok && isString(obj.text)) {
          setStatus("done");
          setMessages((prev) => [
            ...prev,
            {
              id: newMsgIdRef.current(),
              role: "assistant",
              text: obj.text as string,
            },
          ]);
          return;
        }
        setStatus("error");
        const msg =
          (typeof obj.message === "string" ? obj.message : undefined) ||
          (typeof obj.error === "string" ? obj.error : undefined) ||
          "Request failed";
        setMessages((prev) => [
          ...prev,
          { id: newMsgIdRef.current(), role: "assistant", text: String(msg) },
        ]);
      } catch (e: unknown) {
        setStatus("error");
        const msg =
          e && typeof e === "object" && "message" in e
            ? String((e as { message?: string }).message || "Network error")
            : "Network error";
        setMessages((prev) => [
          ...prev,
          { id: newMsgIdRef.current(), role: "assistant", text: msg },
        ]);
      }
    };

    if (ws && ws.readyState === WebSocket.OPEN) {
      sendViaWS(ws);
      return;
    }
    if (ws && ws.readyState === WebSocket.CONNECTING) {
      const trySend = () => {
        const s = wsRef.current;
        if (!s) return;
        if (s.readyState === WebSocket.OPEN) sendViaWS(s);
        else setTimeout(trySend, 200);
      };
      trySend();
      return;
    }
    await fallbackPost();
  }, []);

  useEffect(() => {
    if (speech.isListening) setStatus("listening");
    else if (status === "listening") setStatus("idle");
  }, [speech.isListening, status]);

  const onMicDown = speech.onMicDown;
  const onMicUp = speech.onMicUp;
  const canUseMic = speech.canUse;

  const handleSend = useCallback(() => {
    if (!input.trim()) return;
    void sendPrompt(input.trim());
    setInput("");
  }, [input, sendPrompt]);

  // Approval handled inline via chat bubble actions

  const statusText = useMemo(
    () =>
      ({
        idle: "",
        listening: "Listening… (hold the mic)",
        sending: "Sending…",
        waiting: "Waiting…",
        done: "",
        error: "Error",
      })[status],
    [status]
  );

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <StatusBar style="light" />
      <View style={styles.container}>
        {/* Approval modal removed: approvals now appear inline as chat bubble */}
        {/* Terminal fixed at the top (outside chat scroll) */}
        <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
          <TerminalPanel
            show={showPty}
            running={ptyRunning}
            wsStatus={wsStatus}
            wsLastEvent={wsLastEvent}
            summaryBullets={summaryBullets}
            summaryObj={summaryObj}
            health={health}
            isSummarizing={isSummarizing}
            output={ptyOutput}
            onToggleShow={() => setShowPty((v) => !v)}
            onStart={() => {
              if (ptyRunning) return;
              const ws = wsRef.current;
              if (!ws) {
                pendingStartRef.current = true;
                setWsStatus("connecting");
                connectRef.current?.();
                return;
              }
              const rs = ws.readyState;
              if (rs === WebSocket.OPEN)
                ws.send(JSON.stringify({ type: "startSession", options: {} }));
              else if (rs === WebSocket.CONNECTING) {
                pendingStartRef.current = true;
                setWsStatus("connecting");
              } else {
                pendingStartRef.current = true;
                setWsStatus("connecting");
                connectRef.current?.();
              }
            }}
            onInterrupt={() => {
              const ws = wsRef.current;
              if (ws && ws.readyState === WebSocket.OPEN)
                ws.send(JSON.stringify({ type: "interrupt" }));
            }}
            onStop={() => {
              const ws = wsRef.current;
              if (ws && ws.readyState === WebSocket.OPEN)
                ws.send(JSON.stringify({ type: "stop" }));
            }}
            onClear={() => setPtyOutput("")}
          />
        </View>
        <ScrollView
          ref={messagesScrollRef}
          style={styles.scroll}
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingTop: 12,
            paddingBottom: 8,
          }}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() =>
            messagesScrollRef.current?.scrollToEnd({ animated: true })
          }
        >
          <ChatBubbles
            messages={messages}
            onExpand={(kind) => {
              const ws = wsRef.current;
              if (!ws || ws.readyState !== WebSocket.OPEN) return;
              const requestId = newMsgIdRef.current();
              try {
                ws.send(
                  JSON.stringify({
                    type: "expandRequest",
                    requestId,
                    expandType: kind,
                  })
                );
              } catch {}
            }}
          />
        </ScrollView>
        {/* Composer bar with OS-synced keyboard animation */}
        <AnimatedComposer
          statusText={statusText}
          input={input}
          setInput={setInput}
          canUseMic={canUseMic}
          onMicDown={onMicDown}
          onMicUp={onMicUp}
          onSend={handleSend}
          disabled={status === "listening"}
          bottomInset={insets.bottom}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0b1220" },
  container: { flex: 1 },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#111827",
    backgroundColor: "#0b1220",
  },
  headerTitle: {
    textAlign: "center",
    fontSize: 18,
    fontWeight: "600",
    color: "#e2e8f0",
  },
  scroll: { flex: 1 },
  // Modal styles
  modalOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.4)",
    zIndex: 100,
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  modalCard: {
    width: "100%",
    maxWidth: 480,
    borderRadius: 12,
    backgroundColor: "#0b1220",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#1f2937",
    padding: 12,
  },
  modalTitle: { color: "#e2e8f0", fontWeight: "700", fontSize: 16 },
  modalSub: { color: "#94a3b8", marginTop: 4, fontSize: 12 },
  sectionLabel: { color: "#94a3b8", fontSize: 12, fontWeight: "600" },
  riskItem: { color: "#e2e8f0", fontSize: 14 },
  previewBox: {
    marginTop: 4,
    maxHeight: 200,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#1f2937",
    backgroundColor: "#0f172a",
    borderRadius: 8,
  },
  previewText: {
    color: "#e2e8f0",
    fontSize: 12,
    fontFamily: Platform.select({
      ios: "Menlo",
      android: "monospace",
      default: "monospace",
    }),
  },
  modalRow: {
    marginTop: 12,
    flexDirection: "row",
    gap: 8,
    justifyContent: "flex-end",
  },
  modalBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  modalBtnNeutral: {
    backgroundColor: "#0f172a",
    borderColor: "#334155",
  },
  modalBtnNeutralText: { color: "#e2e8f0", fontWeight: "600" },
  modalBtnPrimary: {
    backgroundColor: "#2563eb",
    borderColor: "#1d4ed8",
  },
  modalBtnPrimaryText: { color: "white", fontWeight: "700" },
});

// Animated composer wrapper component to keep index lean
type AnimatedComposerProps = {
  statusText: string;
  input: string;
  setInput: (v: string) => void;
  canUseMic: boolean;
  onMicDown?: () => void;
  onMicUp?: () => void;
  onSend: () => void;
  disabled?: boolean;
  bottomInset: number;
};

function AnimatedComposer(props: AnimatedComposerProps) {
  const keyboard = useAnimatedKeyboard();
  const containerStyle = useAnimatedStyle(() => {
    const ty = -keyboard.height.value;
    return {
      transform: [
        {
          translateY: withTiming(ty, {
            duration: 180,
            easing: Easing.out(Easing.cubic),
          }),
        },
      ],
      backgroundColor: "#0b1220",
    };
  });
  const spacerStyle = useAnimatedStyle(() => {
    const target = Math.max(props.bottomInset - keyboard.height.value, 0);
    return {
      height: withTiming(target, {
        duration: 180,
        easing: Easing.out(Easing.cubic),
      }),
      backgroundColor: "#0b1220",
    };
  });
  return (
    <>
      <Animated.View style={containerStyle}>
        {props.statusText ? (
          <View style={{ alignItems: "center", backgroundColor: "#0b1220" }}>
            <Text style={{ color: "#64748b", fontSize: 12 }}>
              {props.statusText}
            </Text>
          </View>
        ) : null}
        <ComposerBar
          input={props.input}
          setInput={props.setInput}
          canUseMic={props.canUseMic}
          onMicDown={props.onMicDown}
          onMicUp={props.onMicUp}
          onSend={props.onSend}
          disabled={props.disabled}
        />
      </Animated.View>
      <Animated.View style={spacerStyle} />
    </>
  );
}
