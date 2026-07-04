// 时间线 tab:GET /api/timeline 的推荐信息流,下拉刷新,帖子可赞/收藏/内联回复,
// 右下角悬浮发帖按钮(蓝色圆形)打开发帖弹层。
import { Feather } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ComposeModal } from "../components/ComposeModal";
import { PostCard } from "../components/PostCard";
import { TopBar } from "../components/TopBar";
import { useSettings } from "../lib/settings";
import { useStore } from "../lib/store";
import type { TimelineStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<TimelineStackParamList, "TimelineList">;

export function TimelineScreen({ navigation }: Props) {
  const { theme } = useSettings();
  const { posts, signalsByPost, status, loading, error, refresh, toggleLike, toggleSave, reply, addNote } = useStore();
  const [composeOpen, setComposeOpen] = useState(false);

  return (
    <SafeAreaView edges={["top"]} style={[styles.safe, { backgroundColor: theme.bg }]}>
      <TopBar theme={theme} title="时间线" />

      <FlatList
        contentContainerStyle={posts.length === 0 ? styles.emptyContent : undefined}
        data={posts}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={
          <View style={styles.empty}>
            {loading ? (
              <ActivityIndicator color={theme.muted} />
            ) : (
              <Text style={[styles.emptyText, { color: theme.muted }]}>
                {status === "offline"
                  ? `连不上 API${error ? `:${error}` : ""}\n到「设置」确认地址,真机请填电脑的局域网 IP。`
                  : "时间线还是空的 —— 到电脑端导入来源,或点右下角写一条笔记。"}
              </Text>
            )}
          </View>
        }
        refreshControl={
          <RefreshControl onRefresh={refresh} refreshing={loading} tintColor={theme.muted} />
        }
        renderItem={({ item }) => (
          <PostCard
            card={item}
            onLike={toggleLike}
            onOpen={(card) => navigation.navigate("PostDetail", { cardId: card.id })}
            onReply={reply}
            onSave={toggleSave}
            signal={signalsByPost[item.id]}
            theme={theme}
          />
        )}
      />

      <Pressable
        accessibilityLabel="写笔记"
        accessibilityRole="button"
        onPress={() => setComposeOpen(true)}
        style={[styles.fab, { backgroundColor: theme.blue }]}
      >
        <Feather color="#ffffff" name="edit-3" size={22} />
      </Pressable>

      <ComposeModal
        onClose={() => setComposeOpen(false)}
        onSubmit={addNote}
        theme={theme}
        visible={composeOpen}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  emptyContent: { flexGrow: 1 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },
  emptyText: { fontSize: 15, lineHeight: 22, textAlign: "center" },
  fab: {
    position: "absolute",
    right: 20,
    bottom: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center"
  }
});
