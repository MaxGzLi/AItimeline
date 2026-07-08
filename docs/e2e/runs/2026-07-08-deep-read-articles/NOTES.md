# 2026-07-08 deep-read-articles UI 验收记录

真实数据沙盒验收(快照复制自 `apps/api/data/`,API :8798 + Vite :5198,截图后已关停)。

## 截图

- `dr-reader-model.png` — 深色主题,**真模型生成稿**(deepseek-chat,主题 Multi-head Latent Attention):「模型生成稿」徽标、6 章(3 完成 3 缺口)、缺口章淡底 + 「缺口章」chip + 琥珀色门禁说明、synthesis 段「综合」左边条标记、每章末尾「本章事实来源」。
- `dr-reader-light.png` — 同视图浅色主题。
- `dr-reader-dark.png` — 确定性拼装稿(无模型 fallback,主题 DeepSeek-v3):自我声明为拼装稿,3 章全部来自可回源 chunk。
- `dr-skilltree-entry.png` — 技能树目标行的深读入口(有文章显示「打开深读文章」,无文章显示「生成深读文章」)。

## 真模型验收(spec 标准 5)

- POST /api/deepread + curation/run 实测:job succeeded,runnerKind `model`,6 章,**门禁删段 15 条**,删段理由抽查全部是真问题:引用外 token(GQA/MQA/2024)、悬空引用、段首废话句。
- 结构八条抽查:开头段是「你已经知道标准多头注意力(MHA)…那么有没有办法…」的先行组织者写法;素材不足章节正确降级缺口章并明说。
- 事实回源抽查 3 处:低秩联合压缩、KV 缓存压缩表述、Megatron Core 配置类,均能对回所引 chunk。

## 已知说明

- 频控:每用户每天 1 篇(429);首次点击若前端状态未加载完会把 429 文案裸露显示(已修为不再误判断线,文案本身记后续打磨)。
- 深读文章列表目前只从技能树目标入口进入;不挂目标的文章(直接 POST topic)在 UI 无入口,记后续迭代。
