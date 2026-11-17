# dsh-budget 🐋

按月额度的 DeepSeek 用量预算插件：**月额度 ÷ 当月工作日 = 日均**，没用完的天数自动结转给后面几天，
剩 10% 和 0% 各让 `dsh-pet` 的桌宠提醒一次；超额还能直接**停用**模型调用（进行中的任务先跑完），停用后可以「再用一次」。
账本默认**直接读 DeepSeek 控制台的用量接口**（当月每天真实花了多少），拿不到才退回本地估算与余额差记账。

## 安装

装之前确认宿主里有 `dsh-cost-meter`（官方计费插件，账本靠它）；`dsh-pet` 可选，没有就只是不弹气泡。

在 DSH 的插件管理器里贴这个地址安装（不用 clone、不用 build，`lib/` 里就是能直接跑的 JS）：

```
github:Cicadasrioting/dsh-budget
```

或者本地开发用链接装：

```
link:/absolute/path/to/dsh-budget
```

装完在插件管理里启用 `dsh-budget`，然后刷新页面（F5），左侧栏就有「预算」了。

想自己发 npm 也行：`npm publish` 之后装 `dsh-budget` 这个名字即可。

## 隐私：用你自己的 key

这个插件里**没有任何凭据**，也不会上报任何东西：

- **真账单**走宿主账号的令牌：`deepseekAccount.getPlatformSession()` 由 DSH 持有你登录平台的会话，
  插件只在调用那一瞬间借来用，不写盘、不落日志。
- **余额兜底**需要一个开放平台 Key（`sk-...`），三种给法，按顺序找：
  1. 配置文件里的 `billApiKey`（写在 `~/.dsh/budget.json`，明文，介意就别用这条）；
  2. 环境变量 `DEEPSEEK_API_KEY`（推荐）；
  3. 都没有 → 只显示余额，账本退回本地估算。
- **本地估算**永远可用：`costMeter` 按会话算的那份钱，不需要任何网络和凭据。
- 所有数据都在你自己的 `~/.dsh/` 下（`budget.json` / `budget-billing.json` / `budget-state.json` / `budget-runtime.json`），
  插件不建数据库、不发遥测、不连除 `platform.deepseek.com` 与 `api.deepseek.com` 之外的任何地址。


## 怎么算的

设月额度 `Q`、当月工作日数 `N`、今天是本月的第 `k` 个工作日（今天之前已花 `S`）：

```
日均     base = Q / N
今天可用 = base × k − S        ← 前几天没花完的自然滚进来
今天还剩 = 今天可用 − 今天已花
```

例：日均 8 元，第 1 天花 6 → 第 2 天可用 10（第 2 天只花 3）→ 第 3 天可用 15。

工作日默认是周一到周五，`holidays` 可以减掉法定节假日，`extraWorkdays` 可以补回调休上班的周末。

## 侧边栏「预算」

`dsh.client` 里的侧栏入口 + 中央整页：今天还剩多少、本月额度/工作日/日均、以及配置——

- 每月额度（数字，改完立刻重算）
- **超额就停用**开关
- 桌宠提醒开关
- 停用时的两个按钮：**再用一次**（放行一轮，这轮跑完再停）、**今天恢复**（今天不再自动停）
- **平台账单**：本月已花、今天已花、余额、数据来源、上次同步，以及一张**当月每天消费柱状图**
  （和平台「用量信息」页那张一样，今天那根高亮、悬停看当天金额）

改完插件代码要在页面上刷新一次（F5）才会加载新的客户端束。

## 超额停用怎么工作

1. 每 30 秒（以及改配置时）复核一次；`今天还剩 ≤ 0` 即算超额。
2. 超额 + 开了停用 + 今天没手动恢复 → 停用：
   - 没有任务在跑 → 立刻停；
   - 有任务在跑（`turn/start` 过、还没 `turn/end`）→ 记 `pending`，**等这一回合跑完再停**。
3. 停用的实现点：`ctx.on('llm/stream')` 是宿主的监听器瀑布，不调 `next()` 直接抛错 = 这次模型调用没发出去，
   回合随之失败（报「今日 DeepSeek 额度已用尽」）。子会话、后台调用一样拦。
4. 停用后的出口：
   - **再用一次** → `allowTurn`，放行到下一个 `turn/end`，然后重新停；
   - **今天恢复** → 清停用并标记 `mutedDay=今天`，今天不再自动停；
   - 额度被调高到水下 → 自动解停。
5. 跨天自动清零（状态文件按 `dayKey` 走）。

## 账单同步（平台用量接口 = 真账单）

DeepSeek 开放平台没有公开的「账单 API」，但**控制台「用量信息」页**背后有：

```
GET https://platform.deepseek.com/api/v0/usage/by_api_key/cost?start=<sec>&end=<sec>&tz=<sec>
  → data.biz_data.data[].series[].buckets[] = { time, cost }
```

按天把 `cost` 加起来，就是当月每天真实花掉的钱（和网页柱状图一致）。两个坑：

- `start` / `end` 必须是**本地零点**化过的 epoch 秒：`Math.floor(Date.UTC(y, m, d) / 1000) - tz`，`tz` 是时区秒偏移（东八区 28800）；
- 认证走宿主账号的 token，插件自己不存：`deepseekAccount.getPlatformSession()` 会给 `{ origin, token, requestHeaders }`
  （Host-only 快照），带上 `x-dsh-auth-token` 就能打这个接口。

拿不到 token / 接口失败时的兜底还是余额差记账：

| 来源 | 接口 | 说明 |
| --- | --- | --- |
| 平台用量接口 | `/api/v0/usage/by_api_key/cost` | 真账单，按天，默认走这条 |
| 宿主账号钱包 | `deepseekAccount.getBalance()` | 设置→账号 那个余额；只用来兜底和显示 |
| 开放平台 Key | `GET https://api.deepseek.com/user/balance` | 配了 `billApiKey` 或环境变量 `DEEPSEEK_API_KEY` 才走 |

兜底时每 15 分钟采一次余额，两次之间的**下降**算当天花掉的钱，**上升**算充值（`topups`）。

- 台账：`$DSH_HOME/budget-billing.json`（`days` 每天真实花费 / `monthTotal` 本月合计 / `topups` / `samples` / `source`）
- 每天的钱：台账里有的日子用**真实账单**，没有的日子（插件没开、没联网）退回 `costMeter` 估算；
  面板上「本月账单天数 N 天（其余按估算）」就是这件事。
- 平台数据本身有约 5 分钟延迟，所以「今天」会在 15 分钟一次的同步里慢慢补齐。

## 抠搜模式（峰价攒任务，谷价再跑）

DeepSeek 按 UTC 划峰谷：**北京时间 09:00–12:00 和 14:00–18:00 是峰价**，其余时间、周末和节假日都是平价。
峰谷窗口直接从 `dsh-cost-meter` 的 config 读（`peakEnabled` / `peakWindows` / `peakHolidays`），
所以你在费用统计里改过窗口，这边跟着变，不用重复配置。

打开面板上的「峰价就攒着」，规则就生效了：

1. 你在面板里把活儿扔进队列（一行字当指令，排队时不再花钱）。
2. 峰价期间队列只躺着，面板显示「峰价中，还有 X 小时 Y 分钟转谷价」。
3. 一到平价，60 秒内自动开跑，一次一条，上一条跑完（`turn/end`）自动接下一条。
4. 想插队就点「立刻执行」（`/budget run` 或 `POST /dispatch?force=1`），峰价也照跑。

**自动审批**：打开「自动审批」后，队列里那些活儿的工具审批会按你勾的类型自动放行——
文件写改（`file`）、终端命令（`cmd`）、联网（`net`）、装插件（`plugin`）、其它（`other`）。
工具名想单独放行就填 `autoApproveTools`（子串匹配，比如 `ops_bash`）。

只对**队列派出去的会话**生效：你自己聊天窗口里的审批照旧弹给你，不会被悄悄放行。
判据是 `approval/request` 的 `req.agent.session.id` 在「本插件派出去的会话」名单里；
任何一步拿不准就 `next()`，交回给人。

## 用法

| 做什么 | 怎么做 |
| --- | --- |
| 看今天 | 侧边栏「预算」，或 `/budget`，或 `GET /plugins/dsh-budget/status` |
| 改月额度 | 面板里填，或 `/budget 300`，或 `POST /plugins/dsh-budget/config` `{"monthlyQuota":300}` |
| 关/开提醒 | `/budget off` / `/budget on` |
| 超额停用开关 | 面板开关，或 `/budget stop` |
| 放行一轮 | 面板「再用一次」，或 `/budget once` |
| 今天恢复 | 面板「今天恢复」，或 `/budget resume` |
| 立刻评估一次 | `POST /plugins/dsh-budget/check` |
| 立刻同步账单 | 面板「立即同步」，或 `/budget sync!`，或 `POST /plugins/dsh-budget/sync` |
| 账单同步开关 | 面板开关，或 `/budget sync` |
| 清掉当天标记 | `POST /plugins/dsh-budget/reset`（提醒标记 + 停用状态一起清） |
| 抠搜模式开关 | 面板开关，或 `/budget stingy` |
| 攒一个任务 | 面板输入框「排队」，或 `/budget queue 把测试跑一遍`，或 `POST /plugins/dsh-budget/queue {"text":"..."}` |
| 立刻跑队列 | 面板「立刻执行」，或 `/budget run`，或 `POST /plugins/dsh-budget/dispatch?force=1` |
| 删队列里的任务 | 面板那行的「删掉」，或 `DELETE /plugins/dsh-budget/queue?id=<id>` |
| 自动审批开关 / 类型 | 面板开关与勾选，或 `/budget auto`、`POST config {"autoApprove":true,"autoApproveKinds":["file","cmd"]}` |

配置文件：`$DSH_HOME/budget.json`（默认 `~/.dsh/budget.json`）
提醒标记：`$DSH_HOME/budget-state.json`（每天重置，各档位各提醒一次）
停用状态：`$DSH_HOME/budget-runtime.json`（`pending` / `disabled` / `allowTurn` / `mutedDay`，跨天清零）
账单台账：`$DSH_HOME/budget-billing.json`（`source` 数据来源 / `monthTotal` 本月合计 / `days` 每天真实花费 / `lastTotal` 余额基线 / `topups` 充值 / `samples` 最近 60 次采样）
任务队列：`$DSH_HOME/budget-queue.json`（`items[]`：`id` / `title` / `prompt` / `status`（`queued` `running` `done` `failed`）/ `sessionId` / `createdAt` / `startedAt` / `finishedAt`，保留最近 200 条）

```json
{
  "monthlyQuota": 300,
  "currency": "CNY",
  "holidays": ["2026-10-01"],
  "extraWorkdays": ["2026-10-11"],
  "lowPercent": 10,
  "remind": true,
  "autoDisable": false,
  "stingy": false,
  "autoApprove": false,
  "autoApproveKinds": ["file", "cmd"],
  "autoApproveTools": [],
  "queueCwd": "",
  "billSync": true,
  "billIntervalMinutes": 15,
  "billApiKey": "",
  "petId": "",
  "bubbleMs": 15000
}
```

## 依赖与实现

- 用量：`costMeter.getState()`（`dsh-cost-meter` 的服务），今天 / 当月 / 历史都从它取，
  钱的口径跟侧栏费用统计一致（优先 `costCny`）。
- 提醒：`POST /dsh-pet-7340/broadcast?pet=<id>&surface=any` —— 宠物给第三方插件留的投喂口，
  写进 `pets.<id>.say` 变成气泡。`surface` 必填，`pet` 从 `/dsh-pet-7340/state` 的 `pets` 里挑。
- 停用：`ctx.on('llm/stream', (options, next) => ...)`，拦在 `next()` 之前。
- 账单：`lib/billing.js` 管台账（`recordUsage` 整月覆盖、`recordSample` 算余额差、跨月清零），
  `index.js` 的 `fetchUsage` / `fetchBalance` 负责取数，定时器每 15 分钟跑一次。
- 回合边界：`ctx.on('session/event')` 的 `turn/start` / `turn/end`。
- 抠搜模式的峰谷：读 `costMeter.getState().config` 的 `peakEnabled` / `peakWindows`（UTC 整点）/
  `peakHolidays`，周末与假日直接算平价；逻辑在 `lib/cheap.js`，纯函数，能单独跑。
- 派活：`ctx.get('sessionController')`，`create({ cwd? })` 拿 `sessionId`，再
  `prompt({ requestId, sessionId, mode: 'queue', content: [{ type: 'text', text }] }, signal)`——
  **`signal` 必须传**，不传会报 `throwIfAborted`。跑完靠 `turn/end` 认领，接着派下一条。
- 自动审批：`ctx.on('approval/request', (req, next) => ...)`，返回 `'allowed-once'` 就是放行，
  不认领就 `next()` 交回给人。只认本插件派出去的会话，自己聊天的审批不受影响。
- 客户端：`lib/client.js` 是宿主注入的 `window.__ModuleLoader__` 束，只能 `require` react 外壳种子词，
  所以手写 `createElement`（没有打包器）；侧栏走 `sidebar.panellist`，整页走 `main`（key 必须等于侧栏 id）。
- 每 30 秒评估一次，启动 8 秒后先跑一次。档位提醒按「自然日 + 档位」去重。

## 路由

一律 `exact` 注册（**不能用 prefix**：`/plugins/dsh-budget/client.js` 是宿主发的客户端束，
prefix 会把它吞成 404，侧边栏就永远不出现）。

`GET status`｜`GET|POST config`｜`POST check`｜`POST reset`｜`POST allow-once`｜`POST resume`｜`GET|POST sync`｜`GET|POST|DELETE queue`｜`POST dispatch`（`?force=1` 无视峰价）

## 装/卸

```sh
dsh plugin --profile desktop add link:./dsh-budget   # 或 plugin_manager install_bundle target="link:<路径>"
```

改完 `lib/index.js` 需要重载插件（`plugin_manager set_plugin enabled=false` 再 `true`，
entryId 是 `include:dsh-budget`）；改完 `lib/client.js` 还要刷新页面。

自测：`node scripts/client-smoke.mjs`（假 `window.__ModuleLoader__` 加载客户端束，走真宿主的 `/status`）。
