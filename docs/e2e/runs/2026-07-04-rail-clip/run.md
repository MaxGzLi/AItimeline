# 右栏模块被压扁裁切(知识定位行被齐底切掉)

- 症状:详情页右栏「知识定位」里概念行(#AIAgent + 学习区标签)在模块底边被裁掉一半;「局部图谱」「今日复习」同样被压缩。
- 根因:`.x-rail` 是 `height: 100vh` 的 flex 纵向容器。内容总高超过一屏时,子模块按默认 `flex-shrink: 1` 被压扁去凑一屏,`overflow-y: auto` 永远不触发;模块自身 `overflow: hidden` 于是齐底裁内容。
- 修复:`.x-rail > * { flex-shrink: 0; }` —— 模块保持自然高度,超出走右栏滚动。
- 复现/验证:headless Chrome,1440×900,暗色,点开首卡进入详情;量测 `getBoundingClientRect` 对比 `scrollHeight`。
  - 修前:知识定位 102/124、局部图谱 363/443、今日复习 253/309(可见/内容,全部 clipped),rail scrollHeight = 900(不滚)。
  - 修后:三模块可见高度=内容高度,clipped 全 false,rail scrollHeight 1059 > 900(正常滚动)。
- 截图:`00-before-clipped.png`(main@6c9ba31)/ `01-after-scrolls.png`(本分支)。看右栏「知识定位」模块底部。
