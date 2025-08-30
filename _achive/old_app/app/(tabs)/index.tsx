import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import useSpeech from "@/hooks/useSpeech";

type Status = "idle" | "listening" | "sending" | "waiting" | "done" | "error";

function getWSUrl(): string {
  if (Platform.OS === "web") {
    const win = typeof window !== "undefined" ? window : undefined;
    if (!win) return "";
    const override =
      (process.env?.EXPO_PUBLIC_BACKEND_WS_URL as string | undefined) ||
      (process.env?.NEXT_PUBLIC_BACKEND_WS_URL as string | undefined);
    if (override) return override;
    const host = win.location.hostname;
    const isSecure = win.location.protocol === "https:";
    const proto = isSecure ? "wss" : "ws";
    return `${proto}://${host}:4001/ws`;
  }
  const override = process.env?.EXPO_PUBLIC_BACKEND_WS_URL as
    | string
    | undefined;
  if (override) return override;
  const host = Platform.OS === "android" ? "10.0.2.2" : "localhost";
  return `ws://${host}:4001/ws`;
}

function getHTTPBase(): string {
  if (Platform.OS === "web") {
    const win = typeof window !== "undefined" ? window : undefined;
    if (!win) return "";
    const override =
      (process.env?.EXPO_PUBLIC_BACKEND_HTTP_URL as string | undefined) ||
      (process.env?.NEXT_PUBLIC_BACKEND_HTTP_URL as string | undefined);
    if (override) return override;
    const host = win.location.hostname;
    const proto = win.location.protocol;
    return `${proto}//${host}:4001`;
  }
  const override = process.env?.EXPO_PUBLIC_BACKEND_HTTP_URL as
    | string
    | undefined;
  if (override) return override;
  const host = Platform.OS === "android" ? "10.0.2.2" : "localhost";
  return `http://${host}:4001`;
}

export default function HomeScreen() {
  // Helper: process WS message object
  const handleSummary = useCallback((msg: Record<string, unknown>) => {
    const s = msg.summary as unknown;
    const bulletsVal =
      s && typeof s === "object" && s !== null
        ? (s as { bullets?: unknown }).bullets
        : undefined;
    const arr = Array.isArray(bulletsVal) ? bulletsVal : [];
    const bullets = arr
      .map((b) => (typeof b === "string" ? b : JSON.stringify(b)))
      .filter((t): t is string => typeof t === "string" && t.length > 0);
    setSummaryBullets(bullets);
  }, []);

  const onWsMessageObject = useCallback(
    (msg: Record<string, unknown>) => {
      const type = typeof msg.type === "string" ? msg.type : "";
      setWsLastEvent(type);
      if (type === "ack") {
        setStatus("waiting");
        return;
      }
      if (type === "reply") {
        setStatus("done");
        setMessages((prev) => [
          ...prev,
          {
            id:
              (typeof msg.id === "string" && msg.id) ||
              Math.random().toString(36).slice(2),
            role: "assistant",
            text:
              (typeof msg.text === "string" && msg.text) ||
              String(msg.text ?? ""),
          },
        ]);
        return;
      }
      if (type === "sessionStarted") {
        setPtyRunning(Boolean((msg as Record<string, unknown>).running));
        setShowPty(true);
        return;
      }
      if (type === "output" || type === "replyChunk") {
        const d = (msg as Record<string, unknown>).data;
        setPtyOutput((prev) => prev + String(d ?? ""));
        setShowPty(true);
        return;
      }
      if (type === "summaryUpdate") {
        handleSummary(msg);
        return;
      }
      if (type === "sessionExit") {
        setPtyRunning(false);
        setPtyOutput((prev) => prev + "\n[session exited]\n");
        return;
      }
      if (type === "error") {
        setStatus("error");
        const text =
          (typeof msg.message === "string" && msg.message) ||
          (typeof msg.error === "string"
            ? `Error: ${String(msg.error)}`
            : "Error");
        setMessages((prev) => [
          ...prev,
          {
            id:
              (typeof msg.id === "string" && msg.id) ||
              Math.random().toString(36).slice(2),
            role: "assistant",
            text,
          },
        ]);
      }
    },
    [handleSummary]
  );

  const [errorBanner, setErrorBanner] = useState<string | undefined>(undefined);
  const [status, setStatus] = useState<Status>("idle");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<
    { id: string; role: "user" | "assistant"; text: string }[]
  >([]);
  const [ptyRunning, setPtyRunning] = useState(false);
  const [showPty, setShowPty] = useState(false);
  const [ptyOutput, setPtyOutput] = useState("");
  const [summaryBullets, setSummaryBullets] = useState<string[]>([]);
  const [wsStatus, setWsStatus] = useState("disconnected");
  const [wsLastEvent, setWsLastEvent] = useState("");
  const bottomRef = useRef<View | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const connectRef = useRef<(() => void) | null>(null);
  const pendingStartRef = useRef(false);

  const speech = useSpeech((t: string) => {
    void sendPrompt(t);
  });
  useEffect(() => {
    if (speech.error) setErrorBanner(speech.error);
  }, [speech.error]);

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
          if (pendingStartRef.current) {
            try {
              socket.send(
                JSON.stringify({ type: "startSession", options: {} })
              );
            } catch {}
            pendingStartRef.current = false;
          }
        };
        socket.onmessage = (event) => {
          if (!alive) return;
          try {
            const data = (event as MessageEvent).data as unknown;
            const raw = typeof data === "string" ? JSON.parse(data) : data;
            if (typeof raw !== "object" || raw === null) return;
            onWsMessageObject(raw as Record<string, unknown>);
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
  }, [onWsMessageObject]);

  const lastCountRef = useRef(0);
  useEffect(() => {
    if (messages.length !== lastCountRef.current) {
      lastCountRef.current = messages.length;
    }
  }, [messages]);

  const postFallback = useCallback(async (text: string) => {
    try {
      const base = getHTTPBase();
      const res = await fetch(`${base}/api/prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data: unknown = await res
        .json()
        .catch(() => ({}) as Record<string, unknown>);
      const obj = (
        data && typeof data === "object"
          ? (data as Record<string, unknown>)
          : {}
      ) as Record<string, unknown>;
      if (res.ok && typeof obj.text === "string") {
        setStatus("done");
        setMessages((prev) => [
          ...prev,
          {
            id: Math.random().toString(36).slice(2),
            role: "assistant",
            text: String(obj.text),
          },
        ]);
      } else {
        setStatus("error");
        const msgStr =
          typeof obj.message === "string"
            ? obj.message
            : typeof obj.error === "string"
              ? obj.error
              : "Request failed";
        setMessages((prev) => [
          ...prev,
          {
            id: Math.random().toString(36).slice(2),
            role: "assistant",
            text: msgStr,
          },
        ]);
      }
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
  }, []);

  const sendPrompt = useCallback(
    async (text: string) => {
      setStatus("sending");
      const id = Math.random().toString(36).slice(2);
      setMessages((prev) => [...prev, { id, role: "user", text }]);
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "prompt", id, text }));
      } else if (ws && ws.readyState === WebSocket.CONNECTING) {
        setTimeout(() => {
          try {
            if (ws.readyState === WebSocket.OPEN)
              ws.send(JSON.stringify({ type: "prompt", id, text }));
          } catch {}
        }, 300);
      } else {
        await postFallback(text);
      }
    },
    [postFallback]
  );

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

  const statusText = useMemo(
    () =>
      ({
        idle: "Idle",
        listening: "Listening… (hold the mic)",
        sending: "Sending…",
        waiting: "Waiting…",
        done: "",
        error: "Error",
      })[status],
    [status]
  );

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Voice Coder</Text>
        </View>

        <View style={styles.messages}>
          {messages.length === 0 ? (
            <Text style={styles.empty}>
              Say something or type a message to get started.
            </Text>
          ) : (
            <View>
              {messages.map((m) => (
                <View
                  key={m.id}
                  style={
                    m.role === "user"
                      ? styles.bubbleUser
                      : styles.bubbleAssistant
                  }
                >
                  <Text
                    style={
                      m.role === "user"
                        ? styles.bubbleTextUser
                        : styles.bubbleTextAssistant
                    }
                  >
                    {m.text}
                  </Text>
                </View>
              ))}
              <View ref={bottomRef} />
            </View>
          )}

          <View style={styles.ptyCard}>
            <View style={styles.ptyHeaderRow}>
              <Text style={styles.ptyTitle}>PTY Session</Text>
              <View
                style={{ flexDirection: "row", gap: 8, alignItems: "center" }}
              >
                <Text
                  style={{
                    color: ptyRunning ? "#16a34a" : "#6b7280",
                    fontSize: 12,
                  }}
                >
                  {ptyRunning ? "running" : "stopped"}
                </Text>
                <Text
                  numberOfLines={1}
                  style={{ color: "#9ca3af", fontSize: 10, maxWidth: 180 }}
                >
                  WS: {wsStatus}
                  {wsLastEvent ? ` • Last: ${wsLastEvent}` : ""}
                </Text>
                <Pressable
                  style={styles.btnSmall}
                  onPress={() => setShowPty((v) => !v)}
                >
                  <Text style={styles.btnSmallText}>
                    {showPty ? "Hide" : "Show"}
                  </Text>
                </Pressable>
                <Pressable
                  style={[
                    styles.btnSmall,
                    ptyRunning && styles.btnSmallDisabled,
                  ]}
                  disabled={ptyRunning}
                  onPress={() => {
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
                      ws.send(
                        JSON.stringify({ type: "startSession", options: {} })
                      );
                    else if (rs === WebSocket.CONNECTING) {
                      pendingStartRef.current = true;
                      setWsStatus("connecting");
                    } else {
                      pendingStartRef.current = true;
                      setWsStatus("connecting");
                      connectRef.current?.();
                    }
                  }}
                >
                  <Text style={styles.btnSmallText}>Start</Text>
                </Pressable>
                <Pressable
                  style={[
                    styles.btnSmall,
                    !ptyRunning && styles.btnSmallDisabled,
                  ]}
                  disabled={!ptyRunning}
                  onPress={() => {
                    const ws = wsRef.current;
                    if (ws && ws.readyState === WebSocket.OPEN)
                      ws.send(JSON.stringify({ type: "interrupt" }));
                  }}
                >
                  <Text style={styles.btnSmallText}>Interrupt</Text>
                </Pressable>
                <Pressable
                  style={[
                    styles.btnSmall,
                    !ptyRunning && styles.btnSmallDisabled,
                  ]}
                  disabled={!ptyRunning}
                  onPress={() => {
                    const ws = wsRef.current;
                    if (ws && ws.readyState === WebSocket.OPEN)
                      ws.send(JSON.stringify({ type: "stop" }));
                  }}
                >
                  <Text style={styles.btnSmallText}>Stop</Text>
                </Pressable>
                <Pressable
                  style={styles.btnSmall}
                  onPress={() => setPtyOutput("")}
                >
                  <Text style={styles.btnSmallText}>Clear</Text>
                </Pressable>
              </View>
            </View>
            {showPty && (
              <View style={styles.ptyGrid}>
                <View style={styles.summaryCard}>
                  <Text style={styles.summaryTitle}>Summary</Text>
                  {summaryBullets.length === 0 ? (
                    <Text style={styles.summaryEmpty}>No summary yet…</Text>
                  ) : (
                    <View style={{ gap: 4 }}>
                      {summaryBullets.map((b) => (
                        <Text
                          key={b}
                          style={styles.summaryItem}
                        >{`• ${b}`}</Text>
                      ))}
                    </View>
                  )}
                </View>
                <View style={styles.ptyTermCard}>
                  <Text style={styles.ptyTermText} selectable>
                    {ptyOutput || " "}
                  </Text>
                </View>
              </View>
            )}
          </View>
        </View>

        <View style={styles.composer}>
          <Pressable
            accessibilityLabel={canUseMic ? "Hold to Talk" : "Mic unavailable"}
            onPressIn={canUseMic ? onMicDown : undefined}
            onPressOut={canUseMic ? onMicUp : undefined}
            style={[
              styles.micBtn,
              { backgroundColor: canUseMic ? "#2563eb" : "#9ca3af" },
            ]}
            disabled={!canUseMic}
          >
            <Text style={styles.micIcon}>🎙️</Text>
          </Pressable>
          <View style={styles.inputWrap}>
            <TextInput
              style={styles.input}
              placeholder={
                canUseMic
                  ? "Type a message"
                  : "Type a message (mic unavailable)"
              }
              value={input}
              onChangeText={setInput}
              editable={status !== "listening"}
              onSubmitEditing={handleSend}
              returnKeyType="send"
            />
          </View>
          <Pressable
            onPress={handleSend}
            disabled={!input.trim() || status === "listening"}
            style={[
              styles.sendBtn,
              (!input.trim() || status === "listening") &&
                styles.sendBtnDisabled,
            ]}
          >
            <Text style={styles.sendIcon}>➤</Text>
          </Pressable>
        </View>
        <View style={styles.statusRow}>
          <Text style={styles.statusText}>
            {statusText}
            {errorBanner ? ` • ${errorBanner}` : ""}
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#f9fafb" },
  container: { flex: 1 },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e5e7eb",
    backgroundColor: "white",
  },
  headerTitle: {
    textAlign: "center",
    fontSize: 18,
    fontWeight: "600",
    color: "#111827",
  },
  messages: { flex: 1, paddingHorizontal: 16, paddingVertical: 12 },
  empty: { marginTop: 32, textAlign: "center", color: "#6b7280" },
  bubbleUser: {
    alignSelf: "flex-end",
    backgroundColor: "#2563eb",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    borderBottomRightRadius: 4,
    maxWidth: "80%",
    marginVertical: 4,
  },
  bubbleAssistant: {
    alignSelf: "flex-start",
    backgroundColor: "white",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    borderBottomLeftRadius: 4,
    maxWidth: "80%",
    marginVertical: 4,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  bubbleTextUser: { color: "white" },
  bubbleTextAssistant: { color: "#111827" },
  ptyCard: {
    marginTop: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#e5e7eb",
    backgroundColor: "white",
    borderRadius: 8,
    padding: 8,
  },
  ptyHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
  },
  ptyTitle: { fontWeight: "600", color: "#374151", fontSize: 14 },
  btnSmall: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#d1d5db",
    borderRadius: 6,
    backgroundColor: "#f9fafb",
  },
  btnSmallDisabled: { opacity: 0.5 },
  btnSmallText: { fontSize: 12, color: "#111827" },
  ptyGrid: { marginTop: 8, gap: 8 },
  summaryCard: {
    backgroundColor: "white",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#e5e7eb",
    borderRadius: 8,
    overflow: "hidden",
  },
  summaryTitle: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e5e7eb",
    fontWeight: "600",
    color: "#4b5563",
    fontSize: 12,
  },
  summaryEmpty: { padding: 8, color: "#9ca3af", fontSize: 12 },
  summaryItem: { paddingHorizontal: 12, color: "#111827", fontSize: 14 },
  ptyTermCard: {
    backgroundColor: "#000",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#e5e7eb",
    borderRadius: 8,
    minHeight: 120,
    padding: 8,
  },
  ptyTermText: {
    color: "#b6fcd5",
    fontFamily: Platform.select({
      ios: "Menlo",
      android: "monospace",
      default: "monospace",
    }),
    fontSize: 12,
  },
  composer: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#e5e7eb",
    backgroundColor: "white",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  micBtn: {
    height: 56,
    width: 56,
    borderRadius: 28,
    justifyContent: "center",
    alignItems: "center",
  },
  micIcon: { fontSize: 24, color: "white" },
  inputWrap: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#e5e7eb",
    borderRadius: 999,
    overflow: "hidden",
    backgroundColor: "white",
  },
  input: { paddingHorizontal: 16, paddingVertical: 12, fontSize: 16 },
  sendBtn: {
    height: 48,
    width: 48,
    borderRadius: 24,
    backgroundColor: "#2563eb",
    alignItems: "center",
    justifyContent: "center",
  },
  sendBtnDisabled: { backgroundColor: "#93c5fd" },
  sendIcon: { color: "white", fontSize: 18 },
  statusRow: { alignItems: "center", paddingBottom: 6 },
  statusText: { color: "#6b7280", fontSize: 12 },
});
