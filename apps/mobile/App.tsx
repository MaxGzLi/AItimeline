// 根组件:装配 Provider 与导航。底部四个 tab(时间线/发现/复习/设置),
// 时间线内嵌一个 native-stack 承载帖子详情页。
import { Feather } from "@expo/vector-icons";
import { DarkTheme, DefaultTheme, NavigationContainer, type Theme as NavTheme } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { SettingsProvider, useSettings } from "./src/lib/settings";
import { StoreProvider } from "./src/lib/store";
import type { RootTabParamList, TimelineStackParamList } from "./src/navigation/types";
import { DiscoverScreen } from "./src/screens/DiscoverScreen";
import { PostDetailScreen } from "./src/screens/PostDetailScreen";
import { ReviewScreen } from "./src/screens/ReviewScreen";
import { SettingsScreen } from "./src/screens/SettingsScreen";
import { TimelineScreen } from "./src/screens/TimelineScreen";

const Tab = createBottomTabNavigator<RootTabParamList>();
const TimelineStack = createNativeStackNavigator<TimelineStackParamList>();

function TimelineStackScreen() {
  return (
    <TimelineStack.Navigator screenOptions={{ headerShown: false }}>
      <TimelineStack.Screen component={TimelineScreen} name="TimelineList" />
      <TimelineStack.Screen component={PostDetailScreen} name="PostDetail" />
    </TimelineStack.Navigator>
  );
}

type TabIcon = React.ComponentProps<typeof Feather>["name"];

const tabIcons: Record<keyof RootTabParamList, TabIcon> = {
  TimelineTab: "home",
  DiscoverTab: "compass",
  ReviewTab: "refresh-cw",
  SettingsTab: "settings"
};

const tabLabels: Record<keyof RootTabParamList, string> = {
  TimelineTab: "时间线",
  DiscoverTab: "发现",
  ReviewTab: "复习",
  SettingsTab: "设置"
};

function Navigation() {
  const { theme, themeName } = useSettings();

  const navTheme: NavTheme = {
    ...(themeName === "dark" ? DarkTheme : DefaultTheme),
    colors: {
      ...(themeName === "dark" ? DarkTheme : DefaultTheme).colors,
      background: theme.bg,
      card: theme.bg,
      text: theme.ink,
      border: theme.line,
      primary: theme.blue
    }
  };

  return (
    <NavigationContainer theme={navTheme}>
      <StatusBar style={themeName === "dark" ? "light" : "dark"} />
      <Tab.Navigator
        screenOptions={({ route }) => ({
          headerShown: false,
          tabBarActiveTintColor: theme.blue,
          tabBarInactiveTintColor: theme.muted,
          tabBarStyle: { backgroundColor: theme.bg, borderTopColor: theme.line },
          tabBarLabel: tabLabels[route.name],
          tabBarIcon: ({ color, size }) => <Feather color={color} name={tabIcons[route.name]} size={size} />
        })}
      >
        <Tab.Screen component={TimelineStackScreen} name="TimelineTab" />
        <Tab.Screen component={DiscoverScreen} name="DiscoverTab" />
        <Tab.Screen component={ReviewScreen} name="ReviewTab" />
        <Tab.Screen component={SettingsScreen} name="SettingsTab" />
      </Tab.Navigator>
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <SettingsProvider>
        <StoreProvider>
          <Navigation />
        </StoreProvider>
      </SettingsProvider>
    </SafeAreaProvider>
  );
}
