# arXiv 论文页正确导入(摘要级)

## 背景

用户想让发现链路搜「新论文」。实测:Tavily 能搜到 arXiv 论文(如 arxiv.org/abs/2512.13564),但用文章导入器整理该页时,正文抽取抽到了页脚的 arXivLabs 介绍(页面装饰文字),生成了 3 张跑题卡(已从用户数据清除)。arXiv 摘要页的 DOM 不适合通用抽取,但 arXiv 有**官方元数据 API**(`http://export.arxiv.org/api/query?id_list=<id>`,Atom XML,免 key),能拿到干净的标题/作者/摘要/日期。

## 目标

1. `packages/core/src/transform/articleImport.ts`(或就近新模块):识别 arXiv 链接——`arxiv.org/abs/<id>`、`arxiv.org/pdf/<id>(...)`、`arxiv.org/html/<id>vN` 都归一化出论文 id;
2. 命中时不走 HTML 抽取,改调 arXiv API(用既有的可注入 `options.fetch`),解析 Atom XML 得到:论文标题(作为 source title)、abstract(正文 chunk)、作者+发表日期(可并入一条元信息 chunk 或 source 字段,按现有 schema 最小改动);
3. 解析函数必须是纯函数(输入 XML 字符串),便于无网络测试;
4. 归一化的 source id/URL 用 abs 页(`https://arxiv.org/abs/<id>`),同一论文的 pdf/html/abs 链接去重到同一 source;
5. 非 arXiv 链接行为完全不变。

## 明确不做

- 不做 PDF 全文解析(摘要级即可,全文是后续功能)。
- 不改 schema、不新增 source type(仍是 article)。
- 不动发现/搜索侧(Tavily provider 的时间/站点参数是另一个任务)。
- 不动 apps/web、apps/mobile。

## 验收清单

- [ ] 纯解析函数对内置样例 XML 输出正确的标题/摘要/作者/日期
- [ ] smoke(smoke-core 或 smoke-model,注入假 fetch 返回样例 Atom XML)覆盖:arXiv URL 导入产出以论文摘要为内容的 chunk,标题为论文名;不联网
- [ ] 非 arXiv URL 的既有 smoke 不回归
- [ ] `npm run typecheck && npm run build && npm test` 全绿
- [ ] 真机验证(验收人):导入 arxiv.org/abs/2512.13564 生成的卡是《Memory in the Age of AI Agents》摘要的中文卡,而非 arXivLabs 页脚

## 假设

- 摘要级内容 + 引用出处指向 abs 页,足够支撑「论文进时间线」的第一版。
