// 帖子详情页:标题/正文/要点、出处引用、概念标签、评论线程 + 回复框。
// 证据账本留到 v2。
import { Feather } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { PostCard } from "../components/PostCard";
import { useSettings } from "../lib/settings";
import { useStore } from "../lib/store";
import type { TimelineStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<TimelineStackParamList, "PostDetail">;

export function PostDetailScreen({ navigation, route }: Props) {
  const { theme } = useSettings();
  const { cardsById, signalsByPost, toggleLike, toggleSave, reply } = useStore();
  const card = cardsById[route.params.cardId];

  return (
    <SafeAreaView edges={["top"]} style={[styles.safe, { backgroundColor: theme.bg }]}>
      <View style={[styles.bar, { backgroundColor: theme.bg, borderBottomColor: theme.line }]}>
        <Pressable hitSlop={8} onPress={() => navigation.goBack()}>
          <Feather color={theme.ink} name="arrow-left" size={22} />
        </Pressable>
        <Text style={[styles.barTitle, { color: theme.ink }]}>帖子</Text>
        <View style={styles.barSpacer} />
      </View>

      <ScrollView>
        {card ? (
          <PostCard
            card={card}
            initialThreadOpen
            onLike={toggleLike}
            onReply={reply}
            onSave={toggleSave}
            showFullBody
            signal={signalsByPost[card.id]}
            theme={theme}
          />
        ) : (
          <Text style={[styles.missing, { color: theme.muted }]}>找不到这条帖子,返回时间线刷新看看。</Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  bar: {
    height: 48,
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    gap: 16
  },
  barTitle: { fontSize: 17, fontWeight: "800" },
  barSpacer: { flex: 1 },
  missing: { padding: 32, fontSize: 15, textAlign: "center" }
});
