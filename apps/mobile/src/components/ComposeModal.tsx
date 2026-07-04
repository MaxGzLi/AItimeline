// 发帖弹层:写一条笔记 → POST /api/notes。发布成功后把笔记帖(含观察员回帖)
// 交给调用方 prepend 到时间线,和 web 端逻辑一致。
import { Feather } from "@expo/vector-icons";
import type { KnowledgeCard } from "@aitimeline/core";
import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";

import type { Theme } from "../theme";

export function ComposeModal({
  visible,
  theme,
  onClose,
  onSubmit
}: {
  visible: boolean;
  theme: Theme;
  onClose: () => void;
  onSubmit: (text: string) => Promise<KnowledgeCard>;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setText("");
    setError(null);
    setSending(false);
  }

  async function submit() {
    const value = text.trim();
    if (!value || sending) {
      return;
    }

    setSending(true);
    setError(null);

    try {
      await onSubmit(value);
      reset();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "发布失败,请稍后再试。");
      setSending(false);
    }
  }

  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={visible}>
      <View style={styles.backdrop}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.sheetWrap}>
          <View style={[styles.sheet, { backgroundColor: theme.bg }]}>
            <View style={[styles.header, { borderBottomColor: theme.line }]}>
              <Pressable hitSlop={8} onPress={onClose}>
                <Feather color={theme.ink} name="x" size={22} />
              </Pressable>
              <Text style={[styles.headerTitle, { color: theme.ink }]}>写笔记</Text>
              <Pressable
                disabled={sending || !text.trim()}
                onPress={submit}
                style={[styles.pill, { backgroundColor: theme.blue }, sending || !text.trim() ? styles.pillDisabled : null]}
              >
                {sending ? (
                  <ActivityIndicator color="#ffffff" size="small" />
                ) : (
                  <Text style={styles.pillText}>发布</Text>
                )}
              </Pressable>
            </View>

            <TextInput
              autoFocus
              editable={!sending}
              multiline
              onChangeText={setText}
              placeholder="记点什么?观察员会带着出处回复你。"
              placeholderTextColor={theme.muted}
              style={[styles.input, { color: theme.ink }]}
              value={text}
            />

            {error ? <Text style={[styles.error, { color: theme.red }]}>{error}</Text> : null}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheetWrap: { width: "100%" },
  sheet: { borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingBottom: 24, minHeight: 260 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    height: 52,
    borderBottomWidth: StyleSheet.hairlineWidth
  },
  headerTitle: { fontSize: 16, fontWeight: "800" },
  pill: { borderRadius: 999, paddingHorizontal: 18, paddingVertical: 8, minWidth: 64, alignItems: "center" },
  pillDisabled: { opacity: 0.5 },
  pillText: { color: "#ffffff", fontWeight: "700", fontSize: 14 },
  input: { fontSize: 16, lineHeight: 23, padding: 16, minHeight: 150, textAlignVertical: "top" },
  error: { fontSize: 13, paddingHorizontal: 16 }
});
