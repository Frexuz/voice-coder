import { StyleSheet, Text, View } from "react-native";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

type Props = {
  messages: ChatMessage[];
};

export default function ChatBubbles({ messages }: Props) {
  const content = messages;
  if (content.length === 0) {
    return (
      <Text style={styles.empty}>
        Say something or type a message to get started.
      </Text>
    );
  }
  return (
    <View>
      {content.map((m) => (
        <View
          key={m.id}
          style={m.role === "user" ? styles.bubbleUser : styles.bubbleAssistant}
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
});
