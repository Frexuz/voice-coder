import {
  Eye,
  EyeOff,
  Play,
  Square,
  Terminal as TerminalIcon,
  Trash2,
} from "lucide-react-native";
import { useRef } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

export type TerminalPanelProps = {
  show: boolean;
  running: boolean;
  wsStatus: string;
  wsLastEvent: string;
  summaryBullets: string[];
  output: string;
  onToggleShow: () => void;
  onStart: () => void;
  onInterrupt: () => void;
  onStop: () => void;
  onClear: () => void;
};

export default function TerminalPanel(props: TerminalPanelProps) {
  const {
    show,
    running,
    wsStatus,
    wsLastEvent,
    summaryBullets,
    output,
    onToggleShow,
    onStart,
    onInterrupt,
    onStop,
    onClear,
  } = props;
  const ptyScrollRef = useRef<ScrollView | null>(null);

  return (
    <View style={styles.card}>
      {/* Top row: title left, status right */}
      <View style={styles.headerTop}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <TerminalIcon size={16} color="#86efac" />
          <Text style={styles.title}>Terminal</Text>
        </View>
        <Text numberOfLines={1} style={styles.statusText}>
          {running ? "running" : "stopped"} • WS: {wsStatus}
          {wsLastEvent ? ` • ${wsLastEvent}` : ""}
        </Text>
      </View>
      {/* Controls row */}
      <View style={styles.controlsRow}>
        <Pressable onPress={onToggleShow} style={styles.btnSmall} hitSlop={8}>
          {show ? (
            <EyeOff size={16} color="#e2e8f0" />
          ) : (
            <Eye size={16} color="#e2e8f0" />
          )}
        </Pressable>
        <Pressable
          onPress={running ? undefined : onStart}
          disabled={running}
          style={[styles.btnSmall, running && styles.btnDisabled]}
          hitSlop={8}
        >
          <Play size={16} color="#e2e8f0" />
        </Pressable>
        <Pressable
          onPress={!running ? undefined : onInterrupt}
          disabled={!running}
          style={[styles.btnSmall, !running && styles.btnDisabled]}
          hitSlop={8}
        >
          <Square size={16} color="#e2e8f0" />
        </Pressable>
        <Pressable
          onPress={!running ? undefined : onStop}
          disabled={!running}
          style={[styles.btnSmall, !running && styles.btnDisabled]}
          hitSlop={8}
        >
          <Square size={16} color="#ef4444" />
        </Pressable>
        <Pressable onPress={onClear} style={styles.btnSmall} hitSlop={8}>
          <Trash2 size={16} color="#e2e8f0" />
        </Pressable>
      </View>

      {show && (
        <View style={styles.grid}>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryTitle}>Summary</Text>
            {summaryBullets.length === 0 ? (
              <Text style={styles.summaryEmpty}>No summary yet…</Text>
            ) : (
              <View style={{ gap: 4 }}>
                {summaryBullets.map((b) => (
                  <Text key={b} style={styles.summaryItem}>{`• ${b}`}</Text>
                ))}
              </View>
            )}
          </View>
          <View style={styles.termCard}>
            <ScrollView
              ref={ptyScrollRef}
              style={{ flex: 1 }}
              contentContainerStyle={{ padding: 8 }}
              onContentSizeChange={() =>
                ptyScrollRef.current?.scrollToEnd({ animated: true })
              }
            >
              <Text style={styles.termText} selectable>
                {output || " "}
              </Text>
            </ScrollView>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#1f2937",
    backgroundColor: "#0b1220",
    borderRadius: 12,
    padding: 10,
    shadowColor: "#22c55e",
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  headerTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  },
  controlsRow: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    marginTop: 8,
  },
  statusText: {
    color: "#94a3b8",
    fontSize: 10,
    marginLeft: 8,
    flexShrink: 1,
    textAlign: "right",
  },
  title: { fontWeight: "700", color: "#e2e8f0", fontSize: 14 },
  btnSmall: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#334155",
    borderRadius: 8,
    backgroundColor: "#0f172a",
  },
  btnDisabled: { opacity: 0.5 },
  grid: { marginTop: 8, gap: 8 },
  summaryCard: {
    backgroundColor: "#0f172a",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#1f2937",
    borderRadius: 10,
    overflow: "hidden",
  },
  summaryTitle: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#1f2937",
    fontWeight: "700",
    color: "#94a3b8",
    fontSize: 12,
  },
  summaryEmpty: { padding: 8, color: "#64748b", fontSize: 12 },
  summaryItem: { paddingHorizontal: 12, color: "#e2e8f0", fontSize: 14 },
  termCard: {
    backgroundColor: "#020617",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#1f2937",
    borderRadius: 10,
    minHeight: 120,
    maxHeight: 240,
    overflow: "hidden",
  },
  termText: {
    color: "#a7f3d0",
    fontFamily: Platform.select({
      ios: "Menlo",
      android: "monospace",
      default: "monospace",
    }),
    fontSize: 12,
  },
});
