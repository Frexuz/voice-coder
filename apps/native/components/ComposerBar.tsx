import { Mic, Send } from "lucide-react-native";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from "react-native";

export type ComposerBarProps = {
  input: string;
  setInput: (v: string) => void;
  canUseMic: boolean;
  onMicDown?: () => void;
  onMicUp?: () => void;
  onSend: () => void;
  disabled?: boolean;
};

export default function ComposerBar(props: ComposerBarProps) {
  const { input, setInput, canUseMic, onMicDown, onMicUp, onSend, disabled } =
    props;
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={[styles.composer, { paddingBottom: 8 }]}>
        <Pressable
          accessibilityLabel={canUseMic ? "Hold to Talk" : "Mic unavailable"}
          onPressIn={canUseMic ? onMicDown : undefined}
          onPressOut={canUseMic ? onMicUp : undefined}
          style={[
            styles.micBtn,
            { backgroundColor: canUseMic ? "#065f46" : "#334155" },
          ]}
          disabled={!canUseMic}
        >
          <Mic size={22} color="#d1fae5" />
        </Pressable>
        <View style={styles.inputWrap}>
          <TextInput
            style={styles.input}
            placeholder={
              canUseMic ? "Type a message" : "Type a message (mic unavailable)"
            }
            value={input}
            onChangeText={setInput}
            editable={!disabled}
            onSubmitEditing={onSend}
            returnKeyType="send"
            placeholderTextColor="#64748b"
          />
        </View>
        <Pressable
          onPress={onSend}
          disabled={!input.trim() || disabled}
          style={[
            styles.sendBtn,
            (!input.trim() || disabled) && styles.sendBtnDisabled,
          ]}
        >
          <Send size={18} color="#0b1220" />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  composer: {
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#111827",
    backgroundColor: "#0b1220",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  micBtn: {
    height: 44,
    width: 44,
    borderRadius: 22,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#064e3b",
  },
  inputWrap: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#1f2937",
    borderRadius: 999,
    overflow: "hidden",
    backgroundColor: "#0f172a",
    height: 44,
  },
  input: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 16,
    color: "#e2e8f0",
    height: "100%",
  },
  sendBtn: {
    height: 44,
    width: 44,
    borderRadius: 22,
    backgroundColor: "#34d399",
    alignItems: "center",
    justifyContent: "center",
  },
  sendBtnDisabled: { backgroundColor: "#1f2937" },
});
