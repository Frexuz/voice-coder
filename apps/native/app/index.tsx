import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
  Pressable,
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
function sanitizeAnsi(input: string): string {
  const s = input.replace(/\r(?!\n)/g, "\n");
  let out = "";
  let idx = 0;
  while (idx < s.length) {
    const esc = s.indexOf("\u001b[", idx);
    if (esc === -1) {
      out += s.slice(idx);
      break;
    }
    out += s.slice(idx, esc);
    // advance to the end of the CSI sequence (final byte in @-~)
    let k = esc + 2;
    while (k < s.length) {
      const c = s.charCodeAt(k);
      if (c >= 0x40 && c <= 0x7e) {
        k += 1; // include the final byte
        break;
      }
      k += 1;
    }
    idx = k;
  }
  return out;
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const [status, setStatus] = useState<Status>("idle");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
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
              case "summaryStatus":
                setIsSummarizing(Boolean(rawObj.running));
                break;
              case "reply":
                setStatus("done");
                setMessages((prev) => [
                  ...prev,
                  {
                    id:
                      (typeof rawObj.id === "string" ? rawObj.id : undefined) ||
                      Math.random().toString(36).slice(2),
                    role: "assistant",
                    text: safeToString(rawObj.text),
                  },
                ]);
                break;
              case "sessionStarted":
                setPtyRunning(Boolean(rawObj.running));
                setShowPty(true);
                break;
              case "output":
              case "replyChunk": {
                const chunk = safeToString(rawObj.data ?? "");
                setPtyOutput((prev) => prev + sanitizeAnsi(chunk));
                setShowPty(true);
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
                  {
                    id:
                      (typeof rawObj.id === "string" ? rawObj.id : undefined) ||
                      Math.random().toString(36).slice(2),
                    role: "assistant",
                    text,
                  },
                ]);
                break;
              }
              case "actionRequest": {
                const risks: string[] = Array.isArray(rawObj?.risks)
                  ? (rawObj.risks as string[])
                  : [];
                setPendingAction({
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
                });
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
    const id = Math.random().toString(36).slice(2);
    setMessages((prev) => [...prev, { id, role: "user", text }]);

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
              id: Math.random().toString(36).slice(2),
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
          {
            id: Math.random().toString(36).slice(2),
            role: "assistant",
            text: String(msg),
          },
        ]);
      } catch (e: unknown) {
        setStatus("error");
        const msg =
          e && typeof e === "object" && "message" in e
            ? String((e as { message?: string }).message || "Network error")
            : "Network error";
        setMessages((prev) => [
          ...prev,
          {
            id: Math.random().toString(36).slice(2),
            role: "assistant",
            text: msg,
          },
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

  // Phase 4: Send approval decision
  const sendApproval = useCallback(
    (approve: boolean) => {
      const ws = wsRef.current;
      if (!pendingAction || !ws || ws.readyState !== WebSocket.OPEN) return;
      try {
        ws.send(
          JSON.stringify({
            type: "actionResponse",
            actionId: pendingAction.actionId,
            approve,
          })
        );
      } catch {}
    },
    [pendingAction]
  );

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
        {/* Approval Modal */}
        {pendingAction ? (
          <View style={styles.modalOverlay} pointerEvents="box-none">
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Approval required</Text>
              <Text style={styles.modalSub}>
                {pendingAction.reason || "approval_required"}
              </Text>
              {pendingAction.risks?.length ? (
                <View style={{ marginTop: 8 }}>
                  <Text style={styles.sectionLabel}>Risk markers</Text>
                  <View style={{ gap: 4, marginTop: 4 }}>
                    {pendingAction.risks.map((r) => (
                      <Text key={r} style={styles.riskItem}>{`• ${r}`}</Text>
                    ))}
                  </View>
                </View>
              ) : null}
              {pendingAction.preview ? (
                <View style={{ marginTop: 10 }}>
                  <Text style={styles.sectionLabel}>Preview</Text>
                  <ScrollView
                    style={styles.previewBox}
                    contentContainerStyle={{ padding: 8 }}
                  >
                    <Text style={styles.previewText}>
                      {pendingAction.preview}
                    </Text>
                  </ScrollView>
                </View>
              ) : null}
              <View style={styles.modalRow}>
                <Pressable
                  onPress={() => {
                    sendApproval(false);
                    setPendingAction(null);
                  }}
                  style={[styles.modalBtn, styles.modalBtnNeutral]}
                >
                  <Text style={styles.modalBtnNeutralText}>Deny</Text>
                </Pressable>
                <Pressable
                  onPress={() => sendApproval(true)}
                  style={[styles.modalBtn, styles.modalBtnPrimary]}
                >
                  <Text style={styles.modalBtnPrimaryText}>Approve</Text>
                </Pressable>
              </View>
            </View>
          </View>
        ) : null}
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
          <ChatBubbles messages={messages} />
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
