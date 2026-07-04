// 设置 tab:API 地址(存 AsyncStorage,默认 127.0.0.1:8787)、主题(跟随系统/浅色/
// 深色)、连接状态(/health 探测)。
import { Feather } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { TopBar } from "../components/TopBar";
import { normalizeBaseUrl } from "../lib/api";
import { useSettings, type ThemePref } from "../lib/settings";
import { useHealthProbe } from "../lib/store";

const themeOptions: Array<{ value: ThemePref; label: string }> = [
  { value: "system", label: "跟随系统" },
  { value: "light", label: "浅色" },
  { value: "dark", label: "深色" }
];

export function SettingsScreen() {
  const { theme, apiBaseUrl, setApiBaseUrl, themePref, setThemePref } = useSettings();
  const { state, probe } = useHealthProbe();
  const [draft, setDraft] = useState(apiBaseUrl);

  useEffect(() => {
    setDraft(apiBaseUrl);
  }, [apiBaseUrl]);

  function saveUrl() {
    const next = normalizeBaseUrl(draft);
    if (next && next !== apiBaseUrl) {
      setApiBaseUrl(next);
    }
  }

  const statusLabel = state === "connected" ? "已连接" : state === "checking" ? "探测中…" : "连不上";
  const statusColor = state === "connected" ? theme.repost : state === "checking" ? theme.muted : theme.red;

  return (
    <SafeAreaView edges={["top"]} style={[styles.safe, { backgroundColor: theme.bg }]}>
      <TopBar theme={theme} title="设置" />

      <ScrollView contentContainerStyle={styles.body}>
        <Text style={[styles.sectionTitle, { color: theme.muted }]}>API 地址</Text>
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          onBlur={saveUrl}
          onChangeText={setDraft}
          onSubmitEditing={saveUrl}
          placeholder="http://127.0.0.1:8787"
          placeholderTextColor={theme.muted}
          style={[styles.input, { color: theme.ink, borderColor: theme.line }]}
          value={draft}
        />
        <Text style={[styles.hint, { color: theme.muted }]}>
          真机请填电脑的局域网 IP(如 http://192.168.x.x:8787),并用 AITIMELINE_HOST=0.0.0.0 启动 API。
        </Text>

        <View style={[styles.statusRow, { borderColor: theme.line }]}>
          <View style={styles.statusLeft}>
            <View style={[styles.dot, { backgroundColor: statusColor }]} />
            <Text style={[styles.statusText, { color: theme.ink }]}>连接状态:{statusLabel}</Text>
          </View>
          <Pressable hitSlop={8} onPress={probe} style={styles.refresh}>
            <Feather color={theme.muted} name="refresh-cw" size={16} />
            <Text style={[styles.refreshText, { color: theme.muted }]}>重试</Text>
          </Pressable>
        </View>

        <Text style={[styles.sectionTitle, { color: theme.muted, marginTop: 28 }]}>主题</Text>
        <View style={[styles.segment, { borderColor: theme.line }]}>
          {themeOptions.map((option) => {
            const active = themePref === option.value;
            return (
              <Pressable
                key={option.value}
                onPress={() => setThemePref(option.value)}
                style={[styles.segmentItem, active ? { backgroundColor: theme.btnBg } : null]}
              >
                <Text style={[styles.segmentText, { color: active ? theme.btnInk : theme.ink }]}>{option.label}</Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={[styles.footer, { color: theme.muted }]}>AITimeline 手机端 v1</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  body: { padding: 20 },
  sectionTitle: { fontSize: 13, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
  input: {
    marginTop: 10,
    fontSize: 15,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12
  },
  hint: { fontSize: 13, lineHeight: 19, marginTop: 8 },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 16,
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12
  },
  statusLeft: { flexDirection: "row", alignItems: "center", gap: 10 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  statusText: { fontSize: 15 },
  refresh: { flexDirection: "row", alignItems: "center", gap: 5 },
  refreshText: { fontSize: 14 },
  segment: {
    flexDirection: "row",
    marginTop: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    overflow: "hidden"
  },
  segmentItem: { flex: 1, paddingVertical: 11, alignItems: "center" },
  segmentText: { fontSize: 15, fontWeight: "600" },
  footer: { fontSize: 13, textAlign: "center", marginTop: 36 }
});
