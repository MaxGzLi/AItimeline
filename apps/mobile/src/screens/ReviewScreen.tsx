// 复习 tab:用 core 的 createReviewQueue(卡片+信号来自 store)逐题复习。
// 显示答案 → 记得/模糊/忘了,打分记一条 reviewed 信号(暂不影响间隔,和 web 一致)。
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { TopBar } from "../components/TopBar";
import { formatDueDate } from "../lib/format";
import { useSettings } from "../lib/settings";
import { useStore } from "../lib/store";

export function ReviewScreen() {
  const { theme } = useSettings();
  const { reviewQueue, cardsById, markReviewed } = useStore();
  const [position, setPosition] = useState(0);
  const [revealed, setRevealed] = useState(false);

  const item = reviewQueue[position];
  const card = item ? cardsById[item.cardId] : undefined;

  function grade() {
    if (card) {
      markReviewed(card);
    }
    setRevealed(false);
    setPosition((current) => current + 1);
  }

  if (!item) {
    return (
      <SafeAreaView edges={["top"]} style={[styles.safe, { backgroundColor: theme.bg }]}>
        <TopBar theme={theme} title="复习" />
        <View style={styles.center}>
          <Text style={[styles.done, { color: theme.muted }]}>
            {reviewQueue.length === 0
              ? "复习队列是空的 —— 收藏或点赞过的卡片才会进入复习。"
              : "今天的复习完成了 🎉"}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const prompt = card?.reviewPrompts?.[0];
  const question = prompt?.prompt ?? `回忆一下:「${item.concept}」的核心观点是什么?`;
  const answer = card?.keyTakeaway ?? card?.summary ?? "打开原卡片查看答案。";

  return (
    <SafeAreaView edges={["top"]} style={[styles.safe, { backgroundColor: theme.bg }]}>
      <TopBar theme={theme} title="复习" />

      <ScrollView contentContainerStyle={styles.body}>
        <Text style={[styles.count, { color: theme.muted }]}>
          第 {position + 1} / {reviewQueue.length} 题 · {formatDueDate(item.dueAt)} 到期 · 间隔 {item.intervalDays} 天
        </Text>
        <Text style={[styles.question, { color: theme.ink }]}>{question}</Text>
        <Text style={[styles.from, { color: theme.blue }]}>
          #{item.concept.replace(/\s+/g, "")}
          {card ? ` · 来自《${card.title}》` : ""}
        </Text>

        {revealed ? (
          <>
            <Text style={[styles.answer, { color: theme.ink, borderTopColor: theme.line }]}>{answer}</Text>
            <View style={styles.grades}>
              <Pressable onPress={grade} style={[styles.grade, { backgroundColor: theme.repost }]}>
                <Text style={styles.gradeText}>记得</Text>
              </Pressable>
              <Pressable onPress={grade} style={[styles.grade, { backgroundColor: theme.warn }]}>
                <Text style={styles.gradeText}>模糊</Text>
              </Pressable>
              <Pressable onPress={grade} style={[styles.grade, { backgroundColor: theme.red }]}>
                <Text style={styles.gradeText}>忘了</Text>
              </Pressable>
            </View>
          </>
        ) : (
          <Pressable
            onPress={() => setRevealed(true)}
            style={[styles.reveal, { borderColor: theme.line }]}
          >
            <Text style={[styles.revealText, { color: theme.ink }]}>显示答案</Text>
          </Pressable>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },
  done: { fontSize: 15, lineHeight: 22, textAlign: "center" },
  body: { padding: 20 },
  count: { fontSize: 13 },
  question: { fontSize: 20, fontWeight: "700", lineHeight: 28, marginTop: 16 },
  from: { fontSize: 14, marginTop: 10 },
  answer: { fontSize: 16, lineHeight: 24, marginTop: 20, paddingTop: 20, borderTopWidth: StyleSheet.hairlineWidth },
  grades: { flexDirection: "row", gap: 12, marginTop: 24 },
  grade: { flex: 1, borderRadius: 999, paddingVertical: 12, alignItems: "center" },
  gradeText: { color: "#ffffff", fontWeight: "700", fontSize: 15 },
  reveal: { marginTop: 24, borderWidth: StyleSheet.hairlineWidth, borderRadius: 999, paddingVertical: 12, alignItems: "center" },
  revealText: { fontSize: 15, fontWeight: "700" }
});
