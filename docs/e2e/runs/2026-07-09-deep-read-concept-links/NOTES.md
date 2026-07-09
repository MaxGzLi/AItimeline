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

## 审查修复(合并前,验收人修)

独立审查在编译产物上实测出一条必修 bug 及若干边角,已一并修复并回归:

- **M-1 混合中英概念误链**:`AI芯片` 这类含 CJK 的概念原走裸子串匹配,不查词边界——「OpenAI芯片战略」会从 OpenAI 中间劈出 `[AI芯片]`。修:边界检查按候选词两端字符是否为 ASCII 词字符分别强制(`hasAsciiCompatibleEdges`),`OpenAI芯片` 不再命中、`国产AI芯片` 照常命中。
- **统一小写匹配**:所有候选一律经 lowerText 匹配(CJK 小写恒等),顺带修掉「混合概念拉丁部分大小写敏感」的漏链(`transformer架构` 现可命中 `Transformer架构`)。
- **U+0130 索引错位守卫**:`toLowerCase` 个别字符会膨胀长度导致 lowerText 与原文偏移错位(整段漏链);加 `lowerAligned` 守卫,不对齐时退化为逐段 slice 比较,正常文本零开销。
- **smoke 补强**:同起点对决断言(`注意力机制` vs `注意力`,真正锁住最长优先排序——删掉排序会红)、混合概念边界正反两态、大小写命中、`orderedMentions` 含 start/end 的精确 deepEqual(锁偏移量)。

不修(记为已知边界):全角正文(`ＧＱＡ`)不命中——与下述别名问题同类,纯漏链无误链。

## 已知边界(按设计,不阻塞)

- 「GQA」这类**缩写本身**目前链不上:库内概念是全称 `Group-Query Attention`,自动别名只合并大小写变体、不推断缩写。全称出现处正常链接。缩写自动别名(GQA→Group-Query Attention)是后续单独一单。
- 中文说法(「多头潜在注意力」「KV缓存」)与英文概念(`Multi-head Latent Attention`/`KV Cache`)不同拼写也不互链,同样归入别名问题。
- 链接是读取时现算的:以后库里概念/别名变多,旧文章链接自动变多。
