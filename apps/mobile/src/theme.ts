// X 风格主题:直接搬用 web 端 apps/web/src/xshell.css 的 --x-* 色值,
// 拆成 light / dark 两套 RN 主题对象。黑/白底、1px 细线、#1d9bf0 蓝,
// 不用阴影和卡片堆叠。
export type ThemeName = "light" | "dark";

export interface Theme {
  name: ThemeName;
  bg: string;
  module: string;
  hover: string;
  line: string;
  ink: string;
  muted: string;
  blue: string;
  blueHover: string;
  like: string;
  repost: string;
  warn: string;
  red: string;
  btnInk: string;
  btnBg: string;
  verified: string;
  avatarInk: string;
}

export const lightTheme: Theme = {
  name: "light",
  bg: "#ffffff",
  module: "#f7f9f9",
  hover: "rgba(15, 20, 25, 0.05)",
  line: "#eff3f4",
  ink: "#0f1419",
  muted: "#536471",
  blue: "#1d9bf0",
  blueHover: "#1a8cd8",
  like: "#f91880",
  repost: "#00ba7c",
  warn: "#b98a00",
  red: "#d61f30",
  btnInk: "#ffffff",
  btnBg: "#0f1419",
  verified: "#1d9bf0",
  avatarInk: "#ffffff"
};

export const darkTheme: Theme = {
  name: "dark",
  bg: "#000000",
  module: "#16181c",
  hover: "rgba(231, 233, 234, 0.06)",
  line: "#2f3336",
  ink: "#e7e9ea",
  muted: "#71767b",
  blue: "#1d9bf0",
  blueHover: "#1a8cd8",
  like: "#f91880",
  repost: "#00ba7c",
  warn: "#ffd400",
  red: "#f4212e",
  btnInk: "#0f1419",
  btnBg: "#eff3f4",
  verified: "#1d9bf0",
  avatarInk: "#ffffff"
};

export function themeFor(name: ThemeName): Theme {
  return name === "dark" ? darkTheme : lightTheme;
}
