import { Keyboard, Moon, Server, Sun } from "lucide-react";
import type { ApiStatus } from "../lib/types";

export function SettingsView({
  apiMessage,
  apiStatus,
  onShowShortcuts,
  onToggleTheme,
  theme
}: {
  apiMessage: string;
  apiStatus: ApiStatus;
  onShowShortcuts: () => void;
  onToggleTheme: () => void;
  theme: "light" | "dark";
}) {
  return (
    <>
      <button className="x-setrow" onClick={onToggleTheme} type="button">
        {theme === "dark" ? <Sun size={19} /> : <Moon size={19} />}
        <span className="x-smain">
          <p className="x-sname">主题</p>
          <p className="x-ssub">跟随此开关切换深浅色，也可以按 t</p>
        </span>
        <span className="x-sval">{theme === "dark" ? "深色" : "浅色"}</span>
      </button>

      <div className="x-setrow" role="status">
        <Server size={19} />
        <span className="x-smain">
          <p className="x-sname">本地 API</p>
          <p className="x-ssub">{apiMessage}</p>
        </span>
        <span className="x-sval">
          {apiStatus === "connected" ? "已连接" : apiStatus === "checking" ? "连接中" : "离线"}
        </span>
      </div>

      <div className="x-setrow" role="note">
        <Server size={19} />
        <span className="x-smain">
          <p className="x-sname">模型配置</p>
          <p className="x-ssub">通过 AITIMELINE_MODEL_* 环境变量在服务端配置；未配置时走确定性回退。</p>
        </span>
      </div>

      <button className="x-setrow" onClick={onShowShortcuts} type="button">
        <Keyboard size={19} />
        <span className="x-smain">
          <p className="x-sname">键盘快捷键</p>
          <p className="x-ssub">j / k 移动焦点，Enter 展开，/ 搜索，? 查看全部</p>
        </span>
      </button>
    </>
  );
}
