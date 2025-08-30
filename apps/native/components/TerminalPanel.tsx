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
  ActivityIndicator,
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
  isSummarizing?: boolean;
  summaryObj?: {
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
  } | null;
  health?: {
    engine?: string;
    ok?: boolean;
    server?: boolean;
    model?: string;
    hasModel?: boolean;
    error?: string;
  } | null;
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
    isSummarizing,
    summaryObj,
    health,
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
            <View style={styles.summaryHeaderRow}>
              <Text style={styles.summaryTitle}>Summary</Text>
              {isSummarizing ? (
                <ActivityIndicator size="small" color="#94a3b8" />
              ) : null}
            </View>
            {health ? (
              <Text style={styles.healthRow}>
                Engine: {String(health.engine || "?")}
                {typeof health.ok === "boolean"
                  ? health.ok
                    ? " • healthy"
                    : " • unhealthy"
                  : ""}
                {typeof health.hasModel === "boolean"
                  ? health.hasModel
                    ? " • model ready"
                    : " • model missing"
                  : ""}
                {health.model ? ` • ${health.model}` : ""}
              </Text>
            ) : null}
            {summaryBullets.length === 0 ? (
              <Text style={styles.summaryEmpty}>No summary yet…</Text>
            ) : (
              <View style={{ gap: 4 }}>
                {summaryBullets.map((b) => (
                  <Text key={b} style={styles.summaryItem}>{`• ${b}`}</Text>
                ))}
              </View>
            )}
            {summaryObj ? (
              <View
                style={{ paddingHorizontal: 8, paddingVertical: 6, gap: 6 }}
              >
                <View
                  style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}
                >
                  {Array.isArray(summaryObj.filesChanged) &&
                  summaryObj.filesChanged.length > 0 ? (
                    <Chip label={`Files: ${summaryObj.filesChanged.length}`} />
                  ) : null}
                  {summaryObj.tests &&
                  (summaryObj.tests.passed || summaryObj.tests.failed) ? (
                    <Chip
                      label={`Tests: ${summaryObj.tests.passed ?? 0}✓/${summaryObj.tests.failed ?? 0}✗`}
                    />
                  ) : null}
                  {Array.isArray(summaryObj.errors) &&
                  summaryObj.errors.length > 0 ? (
                    <Chip label={`Errors: ${summaryObj.errors.length}`} />
                  ) : null}
                  {summaryObj.metrics &&
                  typeof summaryObj.metrics.durationMs === "number" ? (
                    <Chip
                      label={`Duration: ${Math.round((summaryObj.metrics.durationMs || 0) / 1000)}s`}
                    />
                  ) : null}
                </View>
                {Array.isArray(summaryObj.filesChanged) &&
                summaryObj.filesChanged.length > 0 ? (
                  <View style={{ marginTop: 4 }}>
                    <Text style={styles.sectionLabel}>Files changed</Text>
                    {summaryObj.filesChanged.slice(0, 5).map((f) => (
                      <Text key={f.path} style={styles.sectionItem}>
                        {f.path}
                        {typeof f.adds === "number" ||
                        typeof f.dels === "number"
                          ? ` (${f.adds ?? 0}+/${f.dels ?? 0}-)`
                          : ""}
                      </Text>
                    ))}
                  </View>
                ) : null}
                {summaryObj.tests &&
                Array.isArray(summaryObj.tests.failures) &&
                summaryObj.tests.failures.length > 0 ? (
                  <View style={{ marginTop: 4 }}>
                    <Text style={styles.sectionLabel}>Test failures</Text>
                    {summaryObj.tests.failures.slice(0, 3).map((t) => (
                      <Text
                        key={`${t.name || ""}:${t.message || ""}`}
                        style={styles.sectionItem}
                      >
                        {t.name || "(unnamed)"}: {t.message || ""}
                      </Text>
                    ))}
                  </View>
                ) : null}
                {Array.isArray(summaryObj.errors) &&
                summaryObj.errors.length > 0 ? (
                  <View style={{ marginTop: 4 }}>
                    <Text style={styles.sectionLabel}>Errors</Text>
                    {summaryObj.errors.slice(0, 3).map((e) => (
                      <Text
                        key={`${e.type || ""}:${e.message || ""}`}
                        style={styles.sectionItem}
                      >
                        {e.type ? `${e.type}: ` : ""}
                        {e.message || ""}
                      </Text>
                    ))}
                  </View>
                ) : null}
              </View>
            ) : null}
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

function Chip({ label }: { label: string }) {
  return (
    <View
      style={{
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 999,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: "#334155",
        backgroundColor: "#0f172a",
      }}
    >
      <Text style={{ color: "#cbd5e1", fontSize: 10 }}>{label}</Text>
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
  summaryHeaderRow: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#1f2937",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  summaryTitle: {
    fontWeight: "700",
    color: "#94a3b8",
    fontSize: 12,
  },
  healthRow: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    color: "#94a3b8",
    fontSize: 10,
  },
  summaryEmpty: { padding: 8, color: "#64748b", fontSize: 12 },
  summaryItem: { paddingHorizontal: 12, color: "#e2e8f0", fontSize: 14 },
  sectionLabel: {
    color: "#94a3b8",
    fontSize: 11,
    fontWeight: "600",
    marginBottom: 2,
  },
  sectionItem: {
    color: "#e2e8f0",
    fontSize: 12,
    paddingHorizontal: 12,
  },
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
