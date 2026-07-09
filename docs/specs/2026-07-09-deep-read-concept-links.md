# 深读正文概念双链:点词跳词条

## 背景与问题

用户澄清「双跳/双链」的真实需求:深读文章正文里出现的库内概念(如 GQA),要像双链笔记一样可点击,点击跳到该概念的词条页。

现状盘点(已侦察):

- 词条页已存在:`ConceptDigestPanel`(概念摘要 brief + 相关卡片 digest + 反链 backlinks),在 `App.tsx` 作为**全局浮层**渲染(不依赖 `activeView`),`setConceptView(concept)` 即打开。在深读视图里打开词条、关掉即回文章,导航天然通,零改动。
- 笔记/评论里的显式 `[[双链]]` 已可点:解析在 `packages/core/src/graph/wikilinks.ts`(`parseWikilinks` / `resolveWikilink`),渲染在 `apps/web/src/lib/wikilinks.tsx`(`renderWithWikilinks`),样式 `.x-wikilink`(xshell.css 2434)。
- 缺口:深读正文(`DeepReadArticleView`)是纯文本渲染,概念不可点。文章文本里也没有 `[[...]]` 标记,需要**自动识别**库内概念。

## 设计

### 1. core 新增概念提及匹配器

新文件 `packages/core/src/graph/conceptMentions.ts`,从 core index 导出:

```ts
createConceptMentionMatcher(input: { cards: KnowledgeCard[] } & ConceptAliasOptions): {
  findMentions(text: string): ConceptMention[]
}
// ConceptMention = { start, end, text, concept /* canonical 拼写 */, slug }
```

- **候选词表**:所有非 `connection_note` 卡片的 `concepts`,加 alias 记录两侧拼写;slug 归一到 canonical。复用 `createConceptAliasResolver` + `createAutomaticConceptAliases`,与 `resolveWikilink` 同口径(参考 wikilinks.ts 110-141 行的写法)。
- **匹配规则**:
  - 纯 latin 候选词:大小写不敏感 + 词边界(命中片段前后字符不得是 `[A-Za-z0-9_]`)——防止 MLA 匹配进 MLATransformerConfig;
  - 含 CJK 的候选词:子串匹配(中文无词边界);
  - 长度 < 2 的候选词跳过;
  - 从左到右非重叠扫描,同一位置有多个候选时取最长(「多头潜在注意力」和「注意力」都是概念时,只命中长的);
  - 只返回能解析成库内概念的命中(**不产生 ghost**——正文里没有库内对应的词一律不链);
  - 返回按 `start` 排序,确定性(相同输入相同输出)。

### 2. web:深读阅读视图渲染链接

- `App.tsx`:给 `DeepReadArticleView` 传 `cards={allCards}`、`conceptAliases`、`onOpenConcept={handleOpenConcept}`。
- `DeepReadArticleView`:`useMemo` 建 matcher;`introduction`、每章 `paragraphs`、`conclusion` 走同一个渲染 helper,命中片段渲染为与 `lib/wikilinks.tsx` 概念链接**完全一致**的 span(`className="x-wikilink concept"`、`role="link"`、`tabIndex={0}`、click stopPropagation、Enter/Space 触发),未命中文本原样保留(注意保持段内其余文本为原始字符串节点)。
- **链接密度**:每个 scope 内每个概念只链**首次出现**(引言一个 scope、每章一个 scope、结语一个 scope;章内跨段落共享去重 Set)——防满屏蓝链。去重在 DeepReadArticleView 里做(渲染策略,不进 core)。
- 文章自身主题词照常可链(词条页有它的卡片和反链,有导航价值)。

### 3. 明确不做

- 不改深读生成管线、不改文章存储 schema——纯渲染时计算,库涨了旧文章的链接自动变多。
- 不动时间线卡片正文的自动链接(卡片已有概念 chips 入口);不动笔记 `[[..]]` 逻辑与反链索引。
- 不做 ghost 链接;不把深读文章纳入词条反链索引(后续单独考虑)。
- 不加依赖、无 API/存储改动、不动 `apps/api`。

## 验证标准

1. `npm run typecheck` / `npm run build` / `npm test` 全绿(网络隔离)。
2. `scripts/smoke-core.mjs` 增补断言(加在 wikilinks 断言区 ~3594 行之后):
   - latin 词边界:文本含 MLATransformerConfig 时概念 MLA 不误链;小写 gqa 命中概念 GQA;
   - CJK 子串:句中「多头潜在注意力」命中;
   - 同位置取最长:同时存在「多头潜在注意力」「注意力」两个概念时只命中长的;
   - 别名:文本用 alias 拼写,命中并解析到 canonical 的 slug/label;
   - 库外词不命中(返回空);
   - 输出按 start 排序、确定性(同输入 deepEqual)。
3. UI 截图:深读正文概念链接渲染态 + 点击后词条浮层打开态(dark/light),放 `docs/e2e/runs/2026-07-09-deep-read-concept-links/`(执行者环境截不了图就留复现脚本/说明,验收人兜底)。
