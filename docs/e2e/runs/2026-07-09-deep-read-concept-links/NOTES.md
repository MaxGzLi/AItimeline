# 2026-07-09 deep-read-concept-links 验收记录

需求:深读正文里的库内概念自动变成可点击链接,点击打开现有词条浮层(ConceptDigestPanel)。规格:`docs/specs/2026-07-09-deep-read-concept-links.md`。

## 实测(真实快照,MLA 深读文章,沙盒 8798/5198)

- 全文渲染 18 个概念链接,分布在引言 + 5 章;**每个 scope 内零重复**(`DeepSeek-V2` 在三个章各链一次、章内不重复)——首次出现去重生效。
- 词边界实测:`MLATransformerConfig` 所在段零链接(`Transformer` 未被误链进长词),`Transformer` 只在独立出现处链上。
- 点击「Group-Query Attention」→ 词条浮层打开(概念简介 + 来路卡片 + 3 张相关卡 + 「对比」关系);Escape 关闭后回到文章原位。
- 综合段样式:链接 computed style 为 `display:inline / text-transform:none / font-size:15px`,未被「综合」标签样式(inline-flex/uppercase/12px)污染——新增的 CSS 覆盖必要且生效。
- 暗色主题正常。

## 截图

- `dcl-article-links-light.png` — 第 4 章正文,Group-Query Attention / Multi-Query Attention / DeepSeek-V2 / 内存瓶颈 蓝链。
- `dcl-concept-panel-light.png` — 点击后词条浮层(文章在底层)。
- `dcl-article-links-dark.png` — 暗色第 1 章;可见 MLATransformerConfig 为纯文本。

## 已知边界(按设计,不阻塞)

- 「GQA」这类**缩写本身**目前链不上:库内概念是全称 `Group-Query Attention`,自动别名只合并大小写变体、不推断缩写。全称出现处正常链接。缩写自动别名(GQA→Group-Query Attention)是后续单独一单。
- 中文说法(「多头潜在注意力」「KV缓存」)与英文概念(`Multi-head Latent Attention`/`KV Cache`)不同拼写也不互链,同样归入别名问题。
- 链接是读取时现算的:以后库里概念/别名变多,旧文章链接自动变多。
