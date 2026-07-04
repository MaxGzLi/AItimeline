import { StyleSheet, Text, View } from "react-native";

import type { Theme } from "../theme";

// 顶部小标题栏:白/黑底 + 1px 底部细线。
export function TopBar({ title, theme, right }: { title: string; theme: Theme; right?: React.ReactNode }) {
  return (
    <View style={[styles.bar, { backgroundColor: theme.bg, borderBottomColor: theme.line }]}>
      <Text style={[styles.title, { color: theme.ink }]}>{title}</Text>
      {right ? <View style={styles.right}>{right}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    height: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16
  },
  title: { fontSize: 17, fontWeight: "800" },
  right: { position: "absolute", right: 16 }
});
