import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
// 官方变量在前,自家样式在后——颜色和圆角只有这一个来源。
import "./tokens-openai.css";
import "./xshell.css";

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

