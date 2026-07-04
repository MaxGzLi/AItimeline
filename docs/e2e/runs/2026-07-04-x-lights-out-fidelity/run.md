# 视觉校准:对齐真 X(lights-out)

依据用户提供的 x.com 暗色主页截图(「感觉还是这个好」),按 docs/specs/2026-07-04-x-lights-out-fidelity.md 执行。

- `00-before-dark.png` — 改前(main,2000×1100 暗色):贴左布局、纯图标窄导航、灰底模块、行高 1.5。
- `01-after-dark.png` — 改后同视口:三栏居中(275/600/350)、宽导航(图标+文字+白色「发帖」)、右栏纯黑底+1px 描边模块、时间线头部只留标签页(毛玻璃)、行高 1.3333。
- `02-after-light.png` — 亮色回归:模块保持 #f7f9f9 灰底填充(X 亮色做法),主按钮黑底白字。
- `03-after-narrow-1280.png` — ≤1300px:导航收回纯图标条,发帖变回圆形图标按钮。
- `04-after-detail-dark.png` — 详情页(1440×900):知识定位/局部图谱/今日复习完整显示,#79 的防裁切不回归(量测:rail scrollHeight 940>900,三模块 clipped=false,模块头 margin 已归零)。

采集:docs/e2e/cdp-shot.mjs,DARK=1 / LIGHT=1,数据为本机真实快照。
