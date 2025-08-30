import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  Platform,
} from "react-native";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  pending?: boolean;
  headerChip?: string; // small label above text (e.g., model/engine)
  footer?: string; // small note below text (e.g., duration)
  mono?: boolean; // render in monospace (for slices)
  actions?: null | {
    approveLabel?: string;
    denyLabel?: string;
    onApprove?: () => void;
    onDeny?: () => void;
  };
  expansions?: {
    kind: "diff" | "first-failure" | "last-error";
    label: string;
  }[];
};

type Props = {
  messages: ChatMessage[];
  onExpand?: (kind: "diff" | "first-failure" | "last-error") => void;
};

export default function ChatBubbles({ messages, onExpand }: Props) {
  const content = messages.filter(
    (m) => m.pending || (m.text && m.text.trim().length > 0) || !!m.actions
  );
  if (content.length === 0) {
    return (
      <Text style={styles.empty}>
        Say something or type a message to get started.
      </Text>
    );
  }
  return (
    <View>
      {content.map((m) => {
        const bubbleStyle =
          m.role === "user" ? styles.bubbleUser : styles.bubbleAssistant;
        const textStyle =
          m.role === "user"
            ? styles.bubbleTextUser
            : styles.bubbleTextAssistant;
        return (
          <View key={m.id} style={bubbleStyle}>
            {m.headerChip && !m.pending ? (
              <View style={styles.headerRow}>
                <Text style={styles.headerChip}>{m.headerChip}</Text>
              </View>
            ) : null}
            {m.pending ? (
              <View style={styles.pendingRow}>
                <ActivityIndicator size="small" color="#94a3b8" />
                <Text style={[textStyle, { marginLeft: 8 }]}>Thinking…</Text>
              </View>
            ) : (
              <Text style={[textStyle, m.mono ? styles.mono : null]}>
                {m.text}
              </Text>
            )}
            {!m.pending && m.footer ? (
              <View style={styles.footerRow}>
                <Text style={styles.footerText}>{m.footer}</Text>
              </View>
            ) : null}
            {!m.pending &&
            m.role === "assistant" &&
            m.expansions &&
            m.expansions.length > 0 &&
            onExpand ? (
              <View style={styles.expansionRow}>
                {m.expansions.map((ex) => (
                  <Pressable
                    key={`${m.id}-${ex.kind}`}
                    onPress={() => onExpand(ex.kind)}
                    style={[styles.actionBtn, styles.actionBtnNeutral]}
                  >
                    <Text style={styles.actionBtnNeutralText}>{ex.label}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
            {m.actions ? (
              <View style={styles.actionsRow}>
                <Pressable
                  onPress={m.actions.onDeny}
                  style={[styles.actionBtn, styles.actionBtnNeutral]}
                >
                  <Text style={styles.actionBtnNeutralText}>
                    {m.actions.denyLabel || "Deny"}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={m.actions.onApprove}
                  style={[styles.actionBtn, styles.actionBtnPrimary]}
                >
                  <Text style={styles.actionBtnPrimaryText}>
                    {m.actions.approveLabel || "Approve"}
                  </Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { marginTop: 16, textAlign: "center", color: "#9ca3af" },
  bubbleUser: {
    alignSelf: "flex-end",
    backgroundColor: "#065f46",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    borderBottomRightRadius: 4,
    maxWidth: "80%",
    marginTop: 4,
    marginBottom: 2,
    shadowColor: "#10b981",
    shadowOpacity: 0.35,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  bubbleAssistant: {
    alignSelf: "flex-start",
    backgroundColor: "#0f172a",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    borderBottomLeftRadius: 4,
    maxWidth: "80%",
    marginTop: 4,
    marginBottom: 2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#1f2937",
  },
  bubbleTextUser: { color: "#d1fae5" },
  bubbleTextAssistant: { color: "#e2e8f0" },
  headerRow: { marginBottom: 4 },
  headerChip: {
    alignSelf: "flex-start",
    color: "#94a3b8",
    backgroundColor: "#0b1220",
    borderColor: "#334155",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    fontSize: 10,
  },
  pendingRow: { flexDirection: "row", alignItems: "center" },
  footerRow: { marginTop: 6 },
  footerText: { color: "#94a3b8", fontSize: 10 },
  expansionRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 8,
    flexWrap: "wrap",
  },
  actionsRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 8,
    justifyContent: "flex-end",
  },
  actionBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  actionBtnNeutral: { backgroundColor: "#0b1220", borderColor: "#334155" },
  actionBtnNeutralText: { color: "#e2e8f0" },
  actionBtnPrimary: { backgroundColor: "#2563eb", borderColor: "#1d4ed8" },
  actionBtnPrimaryText: { color: "#fff", fontWeight: "700" },
  mono: {
    fontFamily: Platform.select({
      ios: "Menlo",
      android: "monospace",
      default: "monospace",
    }),
    fontSize: 12,
  },
});
