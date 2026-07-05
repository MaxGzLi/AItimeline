# 论文卡附图展示(feed 媒体位 + 详情页图集)

数据:测试实例 8794,真实导入 arXiv 2412.19437(DeepSeek-V3,方法卡带 Figure 2)与 2603.07670(无图综述,回归对照)。

- `feed-media-light.png` / `feed-media-dark.png`:时间线上「方法与架构」卡正文下方的 X 式媒体位(圆角 16、1px 描边、白底防透明 PNG、object-fit: contain 不裁图);无 media 的旧卡不受影响。
- `detail-media-light.png` / `detail-media-dark.png`(整页,`-top.png` 为顶部裁剪):详情页正文下的图集,每张图带「图源:论文 Figure N」标签 + 去重前缀的图注;点击图片新标签页打开原图。

截图工具:`docs/e2e/cdp-shot.mjs` + 交互脚本(等待 media 渲染、打开详情、回顶)。
