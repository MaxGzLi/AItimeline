// 发现 tab:GET /api/snapshot 的 sourceCandidates 列表(带状态 chip),
// 顶部「立即整理」按钮调 POST /api/curation/run。
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { TopBar } from "../components/TopBar";
import { fetchSnapshot, runCuration } from "../lib/api";
import { formatCandidateStatus } from "../lib/format";
import { useSettings } from "../lib/settings";
import type { SourceCandidateRecord } from "../lib/types";

export function DiscoverScreen() {
  const { theme, apiBaseUrl } = useSettings();
  const [records, setRecords] = useState<SourceCandidateRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const snapshot = await fetchSnapshot(apiBaseUrl);
      setRecords(snapshot.sourceCandidates ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "无法读取来源候选。");
    } finally {
      setLoading(false);
    }
  }, [apiBaseUrl]);

  useEffect(() => {
    void load();
  }, [load]);

  const curate = useCallback(async () => {
    setRunning(true);
    setError(null);

    try {
      await runCuration(apiBaseUrl);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "整理失败,请稍后再试。");
    } finally {
      setRunning(false);
    }
  }, [apiBaseUrl, load]);

  return (
    <SafeAreaView edges={["top"]} style={[styles.safe, { backgroundColor: theme.bg }]}>
      <TopBar theme={theme} title="发现" />

      <View style={[styles.actionRow, { borderBottomColor: theme.line }]}>
        <Text style={[styles.hint, { color: theme.muted }]}>后台整理会把候选来源转成知识卡片。</Text>
        <Pressable
          disabled={running}
          onPress={curate}
          style={[styles.cta, { backgroundColor: theme.btnBg }, running ? styles.ctaDisabled : null]}
        >
          {running ? (
            <ActivityIndicator color={theme.btnInk} size="small" />
          ) : (
            <Text style={[styles.ctaText, { color: theme.btnInk }]}>立即整理</Text>
          )}
        </Pressable>
      </View>

      <FlatList
        contentContainerStyle={records.length === 0 ? styles.emptyContent : undefined}
        data={records}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={
          <View style={styles.empty}>
            {loading ? (
              <ActivityIndicator color={theme.muted} />
            ) : (
              <Text style={[styles.emptyText, { color: theme.muted }]}>
                {error ? error : "还没有候选来源 —— 在电脑端粘贴链接,或点上面「立即整理」。"}
              </Text>
            )}
          </View>
        }
        refreshControl={<RefreshControl onRefresh={load} refreshing={loading} tintColor={theme.muted} />}
        renderItem={({ item }) => (
          <View style={[styles.row, { borderBottomColor: theme.line }]}>
            <View style={styles.rowMain}>
              <Text style={[styles.rowTitle, { color: theme.ink }]} numberOfLines={2}>
                {item.candidate.source.title || item.candidate.source.url}
              </Text>
              {item.candidate.source.url ? (
                <Text style={[styles.rowUrl, { color: theme.muted }]} numberOfLines={1}>
                  {item.candidate.source.url}
                </Text>
              ) : null}
            </View>
            <View style={[styles.chip, { borderColor: theme.line }]}>
              <Text style={[styles.chipText, { color: theme.muted }]}>{formatCandidateStatus(item.status)}</Text>
            </View>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth
  },
  hint: { flex: 1, fontSize: 13, lineHeight: 18 },
  cta: { borderRadius: 999, paddingHorizontal: 16, paddingVertical: 9, minWidth: 88, alignItems: "center" },
  ctaDisabled: { opacity: 0.6 },
  ctaText: { fontWeight: "700", fontSize: 14 },
  emptyContent: { flexGrow: 1 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },
  emptyText: { fontSize: 15, lineHeight: 22, textAlign: "center" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth
  },
  rowMain: { flex: 1 },
  rowTitle: { fontSize: 15, fontWeight: "600", lineHeight: 20 },
  rowUrl: { fontSize: 13, marginTop: 2 },
  chip: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  chipText: { fontSize: 12 }
});
