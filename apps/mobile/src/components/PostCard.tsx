// 帖子卡片,对齐 web 端 apps/web/src/components/PostView.tsx 的视觉:
// 上下文行、圆头像、认证徽章、#概念标签、出处引用框、互动行、内联回复线程。
import { Feather } from "@expo/vector-icons";
import type { InteractionSignal, KnowledgeCard } from "@aitimeline/core";
import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { formatRelativeTime, getAgentInitials, getAgentName, slugConcept } from "../lib/format";
import type { Theme } from "../theme";

type ThreadBlock = NonNullable<KnowledgeCard["thread"]>[number];

export function PostCard({
  card,
  signal,
  theme,
  onLike,
  onSave,
  onReply,
  onOpen,
  initialThreadOpen = false,
  showFullBody = false
}: {
  card: KnowledgeCard;
  signal?: InteractionSignal;
  theme: Theme;
  onLike?: (card: KnowledgeCard) => void;
  onSave?: (card: KnowledgeCard) => void;
  onReply: (card: KnowledgeCard, text: string) => Promise<void>;
  onOpen?: (card: KnowledgeCard) => void;
  initialThreadOpen?: boolean;
  showFullBody?: boolean;
}) {
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [threadOpen, setThreadOpen] = useState(initialThreadOpen);
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);

  const primaryConcept = card.concepts[0] ?? "知识";
  const source = card.sources[0];
  const isUserNote = source?.type === "user_note";
  const commentBlocks = (card.thread ?? []).filter(
    (block) => block.kind === "user_comment" || block.kind === "agent_reply"
  );
  const replyCount = commentBlocks.length;

  async function submitReply() {
    const text = replyText.trim();
    if (!text || sending) {
      return;
    }

    setSending(true);
    setReplyError(null);

    try {
      await onReply(card, text);
      setReplyText("");
    } catch (error) {
      setReplyError(error instanceof Error ? error.message : "回复失败,请稍后再试。");
    } finally {
      setSending(false);
    }
  }

  return (
    <View style={styles.wrap}>
      {card.recommendedBecause && !isUserNote ? (
        <View style={styles.ctx}>
          <Feather color={theme.muted} name="plus" size={13} />
          <Text style={styles.ctxText} numberOfLines={1}>
            为你推荐 · {card.recommendedBecause}
          </Text>
        </View>
      ) : null}

      <View style={styles.post}>
        <View style={[styles.avatar, isUserNote ? styles.avatarUser : styles.avatarAgent]}>
          <Text style={styles.avatarText}>{isUserNote ? "你" : getAgentInitials(primaryConcept)}</Text>
        </View>

        <View style={styles.main}>
          <View style={styles.head}>
            <Text style={styles.name} numberOfLines={1}>
              {isUserNote ? "你的笔记" : getAgentName(primaryConcept)}
            </Text>
            {isUserNote ? null : <Feather color={theme.verified} name="check-circle" size={15} />}
            <Text style={styles.meta} numberOfLines={1}>
              @{isUserNote ? "you" : slugConcept(primaryConcept)}
            </Text>
            <Text style={styles.meta}>·</Text>
            <Text style={styles.meta}>{formatRelativeTime(card.createdAt)}</Text>
            <Text style={styles.meta}>·</Text>
            <Text style={styles.meta}>{isUserNote ? "笔记" : `${card.estimatedReadMinutes} 分钟读完`}</Text>
          </View>

          <Pressable onPress={onOpen ? () => onOpen(card) : undefined}>
            {isUserNote ? null : <Text style={styles.title}>{card.title}</Text>}
            <Text style={styles.body}>{card.shortBody ?? card.summary}</Text>
            {showFullBody && card.keyTakeaway ? (
              <Text style={styles.takeaway}>要点:{card.keyTakeaway}</Text>
            ) : null}
          </Pressable>

          <View style={styles.tags}>
            {card.concepts.slice(0, 3).map((concept) => (
              <Text key={concept} style={styles.tag}>
                #{concept.replace(/\s+/g, "")}
              </Text>
            ))}
          </View>

          {source && !isUserNote ? (
            <View style={styles.quote}>
              <View style={styles.quoteHead}>
                <Text style={styles.name}>原文出处</Text>
                <Text style={styles.meta} numberOfLines={1}>
                  · {source.title}
                </Text>
              </View>
              <Text style={styles.quoteText}>“{card.keyTakeaway}”</Text>
            </View>
          ) : null}

          <View style={styles.acts}>
            <Pressable
              accessibilityLabel="回复"
              accessibilityRole="button"
              hitSlop={6}
              onPress={() => setThreadOpen((open) => !open)}
              style={styles.act}
            >
              <Feather color={threadOpen ? theme.blue : theme.muted} name="message-circle" size={17} />
              {replyCount > 0 ? (
                <Text style={[styles.actCount, threadOpen ? { color: theme.blue } : null]}>{replyCount}</Text>
              ) : null}
            </Pressable>

            <Pressable
              accessibilityLabel="赞"
              accessibilityRole="button"
              disabled={!onLike}
              hitSlop={6}
              onPress={() => onLike?.(card)}
              style={styles.act}
            >
              <Feather color={signal?.liked ? theme.like : theme.muted} name="heart" size={17} />
            </Pressable>

            <Pressable
              accessibilityLabel="收藏"
              accessibilityRole="button"
              disabled={!onSave}
              hitSlop={6}
              onPress={() => onSave?.(card)}
              style={styles.act}
            >
              <Feather color={signal?.saved ? theme.blue : theme.muted} name="bookmark" size={17} />
            </Pressable>

            <Pressable disabled hitSlop={6} style={styles.act}>
              <Feather color={theme.muted} name="clock" size={17} />
              {card.reviewPrompts?.[0]?.dueInDays !== undefined ? (
                <Text style={styles.actCount}>{card.reviewPrompts[0].dueInDays} 天</Text>
              ) : null}
            </Pressable>
          </View>

          {threadOpen ? (
            <View style={styles.replies}>
              {commentBlocks.map((block: ThreadBlock) => {
                const isAgent = block.kind === "agent_reply";

                return (
                  <View key={block.id} style={styles.reply}>
                    <View style={[styles.replyAvatar, isAgent ? styles.avatarAgent : styles.avatarUser]}>
                      <Text style={styles.replyAvatarText}>{isAgent ? "AI" : "你"}</Text>
                    </View>
                    <View style={styles.replyMain}>
                      <View style={styles.head}>
                        <Text style={styles.replyName} numberOfLines={1}>
                          {block.title}
                        </Text>
                        {isAgent ? <Feather color={theme.verified} name="check-circle" size={13} /> : null}
                      </View>
                      <Text style={styles.body}>{block.body}</Text>
                    </View>
                  </View>
                );
              })}

              <View style={styles.replyForm}>
                <TextInput
                  editable={!sending}
                  onChangeText={setReplyText}
                  placeholder="回复…"
                  placeholderTextColor={theme.muted}
                  style={styles.replyInput}
                  value={replyText}
                  onSubmitEditing={submitReply}
                />
                <Pressable
                  disabled={sending || !replyText.trim()}
                  onPress={submitReply}
                  style={[styles.pill, sending || !replyText.trim() ? styles.pillDisabled : null]}
                >
                  {sending ? (
                    <ActivityIndicator color={theme.btnInk} size="small" />
                  ) : (
                    <Text style={styles.pillText}>发送</Text>
                  )}
                </Pressable>
              </View>

              {replyError ? <Text style={styles.replyError}>{replyError}</Text> : null}
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}

function createStyles(theme: Theme) {
  return StyleSheet.create({
    wrap: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.line,
      backgroundColor: theme.bg
    },
    ctx: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingTop: 10,
      paddingHorizontal: 16,
      paddingLeft: 52
    },
    ctxText: { color: theme.muted, fontSize: 13, flexShrink: 1 },
    post: { flexDirection: "row", padding: 12, paddingHorizontal: 16, gap: 10 },
    avatar: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
    avatarAgent: { backgroundColor: theme.blue },
    avatarUser: { backgroundColor: theme.repost },
    avatarText: { color: theme.avatarInk, fontWeight: "700", fontSize: 13 },
    main: { flex: 1 },
    head: { flexDirection: "row", alignItems: "center", gap: 4, flexWrap: "wrap" },
    name: { color: theme.ink, fontWeight: "700", fontSize: 15, maxWidth: "60%" },
    meta: { color: theme.muted, fontSize: 14 },
    title: { color: theme.ink, fontWeight: "700", fontSize: 16, marginTop: 4 },
    body: { color: theme.ink, fontSize: 15, lineHeight: 21, marginTop: 2 },
    takeaway: { color: theme.muted, fontSize: 14, lineHeight: 20, marginTop: 6 },
    tags: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
    tag: { color: theme.blue, fontSize: 14 },
    quote: {
      marginTop: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.line,
      borderRadius: 14,
      padding: 12
    },
    quoteHead: { flexDirection: "row", alignItems: "center", gap: 4 },
    quoteText: { color: theme.ink, fontSize: 14, lineHeight: 20, marginTop: 4 },
    acts: { flexDirection: "row", alignItems: "center", gap: 40, marginTop: 12 },
    act: { flexDirection: "row", alignItems: "center", gap: 6 },
    actCount: { color: theme.muted, fontSize: 13 },
    replies: { marginTop: 12, gap: 14 },
    reply: { flexDirection: "row", gap: 8 },
    replyAvatar: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
    replyAvatarText: { color: theme.avatarInk, fontWeight: "700", fontSize: 11 },
    replyMain: { flex: 1 },
    replyName: { color: theme.ink, fontWeight: "700", fontSize: 14, maxWidth: "80%" },
    replyForm: { flexDirection: "row", alignItems: "center", gap: 8 },
    replyInput: {
      flex: 1,
      color: theme.ink,
      fontSize: 15,
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.line,
      borderRadius: 999
    },
    pill: {
      backgroundColor: theme.blue,
      borderRadius: 999,
      paddingHorizontal: 16,
      paddingVertical: 8,
      minWidth: 56,
      alignItems: "center"
    },
    pillDisabled: { opacity: 0.5 },
    pillText: { color: "#ffffff", fontWeight: "700", fontSize: 14 },
    replyError: { color: theme.red, fontSize: 13 }
  });
}
