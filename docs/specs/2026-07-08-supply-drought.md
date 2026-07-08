# 供给枯竭:检测、主动提示与一键自救

## 背景与目标

真实数据体检(2026-07-08):新卡按天 47→14→1,供给断流;订阅 0 条;来源候选池 pending 116 / queued 106 却只转化 28 条导入;时间线 69 张卡里 48 张靠已读衰减留存。结构性原因:grounding 红线下派生生产不增熵,没有新源时时间线只能回锅,而系统对「枯竭」这个状态完全沉默。用户定案:**枯竭时系统必须主动提示加入新源并能一键采取措施,不能一潭死水**。

## 设计

### 1. 枯竭检测(api,纯确定性,零模型)

- `GET /api/timeline` 响应新增 `supplyStatus` 对象(每次请求实时计算,不持久化):
  - `newCards48h`:近 48h 创建的内容卡数(非 connection_note);
  - `pendingCandidates` / `queuedCandidates`:候选池计数;
  - `activeSubscriptions`:active 订阅数;
  - `queuedImports`:队列中 queued 状态的 import_source 数;
  - `budgetRemaining`:今日自动 job 预算余量;
  - `reviewDueCount`:今日到期复习数;
  - `drought: boolean`:`newCards48h < 3` 即枯竭(阈值常量,不做配置项)。

### 2. 时间线枯竭卡(web)

- `drought === true` 时,时间线列表顶部渲染一张**系统状态卡**(由 `supplyStatus` 派生,前端组件,不入库、不可点赞/收藏):
  - 诊断行:「近两天只有 {newCards48h} 张新卡」+ 事实行(候选池 {pendingCandidates} 条待挖 / 订阅 {activeSubscriptions} 条 / 今日复习 {reviewDueCount} 张);
  - 动作按钮三个:**配订阅**(跳智能体页订阅管理)、**挖候选池**(调 §4 refill 端点,按钮态显示结果:已入队 N 条)、**导入链接**(跳现有导入入口);
  - `reviewDueCount > 0` 时附「去复习」链接。
- X 风格:复用 `--x-*` 变量与既有系统卡语言(参考「新内容生产中」pill 与周报卡的克制程度),贴左、扁平、无图标堆砌;i18n 双语,组件内禁止中文硬编码。
- 枯竭恢复(drought=false)后卡自动消失。

### 3. 枯竭通知(api,频控)

- 后台 worker 周期检查(挂在既有轮询循环上):进入枯竭时创建一条通知(新 kind `supply_drought`,渲染复用现有通知列表分支,纯模板 zh/en,正文含候选池/订阅数事实与建议);
- **频控:枯竭期间只发一条**——存在未读/已读的同 kind 通知且其创建时间晚于最近一次供给恢复,则不再发;供给恢复(newCards48h ≥ 阈值)后重新计。通知 id 确定性(按「枯竭期开始日」hash),天然幂等。

### 4. 一键挖候选池 + 自动倾斜(api)

- 新端点 `POST /api/supply/refill`:把 pending 候选按既有候选分排序取 top-K(K=5)转 import_source job;**占每日预算、走既有门禁、复用既有入队去重**;预算不足时入队到余量为止,返回 `{queued, skipped, budgetRemaining}`;重复调用不重复入队(靠既有队列去重),幂等。
- **不可达标记(还网络欠账)**:import_source job 因 fetch 网络错误失败时,把对应候选标记 `status: "unreachable"`(候选状态机新增值,normalize 兼容);unreachable 候选不再被 refill 与后台计划选中,不再空耗预算。仅网络类错误(超时/连接失败)标记,解析类错误维持既有 failed 语义。
- **自动倾斜**:后台策展计划在 `drought === true` 时,把当日预算空余额度优先分配给候选导入试探(等价于系统自动做一次 refill,同一条代码路径),不等用户点按钮。

## 明确不做

- 不做代理/网络配置(fetch 不走代理是环境属性,另单);
- 不做订阅源推荐算法(枯竭卡只引导到手动添加);
- 不改 ranker(探索槽/同簇限流另单);
- 不做枯竭阈值配置化;不做枯竭历史页;
- 零模型调用,全部确定性;不引入新 npm 依赖;
- 不改门禁、预算逻辑本身(只是消费方)。

## 验证标准

1. `npm run typecheck` / `npm run build` / `npm test` 全绿(网络隔离)。
2. smoke-api:构造老卡快照断言 `supplyStatus.drought===true` 且计数正确;新卡充足时 `drought===false`;refill 入队 top-K 占预算、重复调用不重复入队、预算耗尽时 skipped;unreachable 候选不被 refill 选中;网络失败的 import job 把候选置 unreachable;枯竭通知创建且重复检查不重复发;旧快照(候选无 unreachable)normalize 兼容。
3. UI 截图(验收人):枯竭卡(含三动作与事实行)浅色+深色;点「挖候选池」后按钮反馈态。
4. 真实数据验收(验收人):真实快照下 drought=true、枯竭卡出现;点挖候选池入队且占预算;通知出现且只一条。
