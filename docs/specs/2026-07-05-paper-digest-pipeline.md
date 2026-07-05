# 论文消化管线(一期:全文板块拆解 + 论文原图进卡)

## 背景

用户要求:导入论文时按常见板块拆解(方法/架构、实验的具体细节),且知识卡要能带图。已确认的技术事实:arXiv 的 LaTeX→HTML 全文(LaTeXML,`arxiv.org/html/<id>`)对较新论文可用,含章节结构、`<figure>`+`<figcaption>`;部分论文无 HTML(只有占位页)。用户拍板:图用**论文原图**(二期加提取式 Mermaid 结构图,标注「派生」);图片**下载到本地缓存**;一篇论文拆**固定 3-4 张板块卡**。

## 一期目标

### 1. arXiv 全文获取与拆解(packages/core)

- 导入 arXiv 链接时先试 `https://arxiv.org/html/<id>`;识别「无 HTML」占位页(小体积/无 ltx 结构)→ 回退现有摘要卡路径(行为不变)。
- 解析 LaTeXML 结构(`ltx_section`/`ltx_title`/`ltx_para` 等 class):抽出章节标题与段落文本。
- 章节归一到板块桶:摘要+引言→「动机与问题」;method/approach/model/architecture→「方法与架构」;experiment/setup/evaluation→「实验设置」;result/discussion/ablation→「结果与消融」;limitation/conclusion→「局限与结论」。未识别章节归「其他」。每桶文本切段注册为出处 chunks(单 chunk 有长度上限,总 chunk 数有上限)。
- 图表提取:`<figure>` 的 `<img src>`(解析相对路径;`data:` 内嵌 base64 同样支持)+ `<figcaption>` 文本 + 图号(Figure N / Table N)。caption 注册为出处 chunk。

### 2. 图片本地缓存与服务(core 类型 + apps/api)

- `SourceAsset` 增加 `kind: "image"` 形态:`{id, sourceId, kind:"image", url(对外服务路径), caption, figureLabel, createdAt}`。
- 下载器:只允许 arxiv.org 域(SSRF 白名单);写入媒体目录(默认 `apps/api/data/media/<sourceId>/`,目录可注入以便测试);`data:` URI 直接解码落盘。失败的图跳过不阻塞导入。
- apps/api 新增 `GET /media/...` 静态路由(路径穿越防护),卡片里的图片 URL 指向它。

### 3. 论文卡生成(模型协议)

- 输入:板块桶 chunks + 图表清单(assetId + caption + figureLabel)。
- 产出**固定 3-4 张中文卡**(语言门禁已就位):
  1. 概览卡(问题与核心贡献,引摘要/引言 chunks);
  2. 方法与架构卡(引方法桶;附架构图——模型只能从图表清单中选 assetId);
  3. 实验与结果卡(数据集、基线、关键数字——数字精确校验已就位;附结果图/表);
  4. 局限与结论卡(该桶存在才生成)。
- `KnowledgePost` 增加可选 `media?: Array<{assetId, caption, origin: "paper" | "derived"}>`;校验:assetId 必须存在于来源资产中(杜绝编造图);一期 origin 只有 "paper"。
- 确定性回退(无模型):每板块桶产一张抽取式卡(来源语言),方法卡/实验卡按 caption 关键词附第一张匹配图;无 HTML 时维持现有摘要卡。

### 4. Web UI(主会话亲自做)

- feed 卡片:正文下方 X 式媒体位(圆角 16、1px 描边、限高),显示第一张图;
- 详情页:全部图片 + caption + 图号标签(「图源:论文 Figure 2」);
- 点击图片新标签页打开原图(一期不做灯箱);
- 快照里无 media 字段的旧卡完全不受影响。

## 明确不做(一期)

- Mermaid 提取式结构图(二期,标注「派生图」)。
- PDF 解析、非 arXiv 论文、ar5iv 镜像回退、mobile 端图片渲染、主题雷达。
- 图片压缩/缩略图。

## 验收清单

- [ ] smoke(离线,注入假 fetch + 内置 LaTeXML 样例 + 假图片字节):章节正确归桶;figure 资产落盘到注入目录;caption 成为 chunk;媒体校验拒绝未知 assetId;无 HTML 占位页回退摘要路径
- [ ] smoke-api:/media 路由能取到写入的假图,路径穿越被拒
- [ ] 旧快照(无 media 字段)加载与展示不回归
- [ ] `npm run typecheck && npm run build && npm test` 全绿
- [ ] 真机:导入 arxiv 2603.07670(有 HTML)产出 3-4 张中文板块卡,方法卡带图,图片本地可访问;导入 2512.13564(无 HTML)回退摘要卡不报错
- [ ] UI 截图:feed 带图卡 + 详情页多图(明暗两主题)

## 假设(用户可推翻)

- 一篇论文 3-4 张卡一次性进时间线(不做分批释放)。
- 图片版权:本地个人使用;将来托管前再议授权与对象存储。
