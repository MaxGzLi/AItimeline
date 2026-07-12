// 复习 tab:队列以服务端 /api/review/due 为真源,逐题复习。
// 显示答案 → 记得/模糊/忘了三档真评分(走 /api/review/:postId/complete 推进间隔);
// 提交失败显示错误并停在当前题,不本地假报完成。
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { TopBar } from "../components/TopBar";
import { formatDueDate } from "../lib/format";
import { useSettings } from "../lib/settings";
import { useStore } from "../lib/store";
import type { ReviewGrade } from "../lib/types";

export function ReviewScreen() {
  const { theme } = useSettings();
  const { reviewDue, cardsById, completeReview, status } = useStore();
  const [revealed, setRevealed] = useState(false);
  const [doneCount, setDoneCount] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // 完成一题后 store 会把它从 reviewDue 移除,下一题自动补位到队首。
  const item = reviewDue[0];
  const card = item ? cardsById[item.postId] : undefined;
  const total = doneCount + reviewDue.length;

  async function grade(value: ReviewGrade) {
    if (!item || submitting) {
      return;
    }

    setSubmitting(true);
    setSubmitError(null);

    try {
      await completeReview(item.postId, value);
      setDoneCount((current) => current + 1);
      setRevealed(false);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "提交失败,请稍后再试。");
    } finally {
      setSubmitting(false);
    }
  }

  if (!item) {
    const message =
      doneCount > 0
        ? "今天的复习完成了 🎉"
        : status === "offline"
          ? "连接不上服务,拿不到复习队列 —— 检查设置里的 API 地址后下拉刷新。"
          : "暂时没有到期的复习。";

    return (
      <SafeAreaView edges={["top"]} style={[styles.safe, { backgroundColor: theme.bg }]}>
        <TopBar theme={theme} title="复习" />
        <View style={styles.center}>
          <Text style={[styles.done, { color: theme.muted }]}>{message}</Text>
        </View>
      </SafeAreaView>
    );
  }

  // 到期卡可能不在推荐流里(library/feed 分离),card 拿不到时用兜底文案。
  const concept = card?.concepts[0];
  const question =
    item.reviewPrompt?.prompt ??
    (concept ? `回忆一下:「${concept}」的核心观点是什么?` : "回忆一下这张卡片的核心观点是什么?");
  const answer = item.reviewPrompt?.answerHint ?? card?.keyTakeaway ?? card?.summary ?? "打开原卡片查看答案。";

  return (
    <SafeAreaView edges={["top"]} style={[styles.safe, { backgroundColor: theme.bg }]}>
      <TopBar theme={theme} title="复习" />

      <ScrollView contentContainerStyle={styles.body}>
        <Text style={[styles.count, { color: theme.muted }]}>
          第 {doneCount + 1} / {total} 题 · {formatDueDate(item.dueAt)} 到期 · 间隔 {item.intervalDays} 天
        </Text>
        <Text style={[styles.question, { color: theme.ink }]}>{question}</Text>
        {concept || card ? (
          <Text style={[styles.from, { color: theme.blue }]}>
            {concept ? `#${concept.replace(/\s+/g, "")}` : ""}
            {card ? `${concept ? " · " : ""}来自《${card.title}》` : ""}
          </Text>
        ) : null}

        {revealed ? (
          <>
            <Text style={[styles.answer, { color: theme.ink, borderTopColor: theme.line }]}>{answer}</Text>
            <View style={styles.grades}>
              <Pressable
                disabled={submitting}
                onPress={() => grade("remembered")}
                style={[styles.grade, { backgroundColor: theme.repost }, submitting ? styles.gradeDisabled : null]}
              >
                <Text style={styles.gradeText}>记得</Text>
              </Pressable>
              <Pressable
                disabled={submitting}
                onPress={() => grade("fuzzy")}
                style={[styles.grade, { backgroundColor: theme.warn }, submitting ? styles.gradeDisabled : null]}
              >
                <Text style={styles.gradeText}>模糊</Text>
              </Pressable>
              <Pressable
                disabled={submitting}
                onPress={() => grade("forgot")}
                style={[styles.grade, { backgroundColor: theme.red }, submitting ? styles.gradeDisabled : null]}
              >
                <Text style={styles.gradeText}>忘了</Text>
              </Pressable>
            </View>
            {submitting ? <ActivityIndicator color={theme.muted} style={styles.pending} /> : null}
            {submitError ? <Text style={[styles.error, { color: theme.red }]}>{submitError}</Text> : null}
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
  gradeDisabled: { opacity: 0.5 },
  gradeText: { color: "#ffffff", fontWeight: "700", fontSize: 15 },
  pending: { marginTop: 16 },
  error: { fontSize: 14, lineHeight: 20, marginTop: 16, textAlign: "center" },
  reveal: { marginTop: 24, borderWidth: StyleSheet.hairlineWidth, borderRadius: 999, paddingVertical: 12, alignItems: "center" },
  revealText: { fontSize: 15, fontWeight: "700" }
});
