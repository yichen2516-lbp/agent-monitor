# Agent Monitor 重构计划

## 目标

在**不改变现有功能和对外接口**的前提下，继续推进 `agent-monitor` 模块化，降低 `index.js` 和前端单文件脚本的复杂度，为后续功能扩展（视图增强、筛选增强、详情增强、workspace 能力增强）打基础。

核心原则：
- **先拆结构，不改行为**
- **先高收益，再深治理**
- **每一步都可运行、可回滚、可验证**

---

## 当前问题概览

### 1. `index.js` 责任过多
当前同时承担了：
- 配置加载
- 日志滚动与清理
- Express 启动
- API 路由
- Workspace 路由
- Workspace 页面 HTML/CSS 内联模板
- 文件查看页 HTML/CSS 内联模板

结果：
- 入口文件过长，阅读成本高
- 页面层和服务层耦合严重
- 任意一个 UI 变更都要修改 server entry
- 难以单独测试 route / template / helper

### 2. `public/monitor.js` 前端职责混合
当前混合了：
- DOM 初始化
- 格式化函数
- 活动渲染
- 筛选逻辑
- 错误聚合
- 指标计算
- 轮询与快慢模式切换
- 系统面板更新
- Drawer 交互
- LocalStorage 状态持久化

结果：
- 可维护性下降
- 后续加功能容易继续堆大
- 逻辑复用困难

### 3. `server/monitor-store.js` 业务核心逐步臃肿
当前同时处理：
- session 文件扫描
- cron 文件扫描
- 新旧日志协议兼容
- activity 解析与归一化
- tool call / tool result 配对
- fs.watch 增量监听
- 内存活动存储
- 对外状态聚合输出

结果：
- 解析逻辑和存储逻辑耦合
- watcher 与 parser 边界不清
- 后续支持更多 event 类型时会继续膨胀

---

## 重构目标结构（建议）

```text
agent-monitor/
├── index.js                     # 极薄入口：装配 app + 启动
├── public/
│   ├── monitor.js               # 临时保留，逐步瘦身
│   ├── monitor.css
│   ├── workspace.js             # 新增：workspace 页面交互
│   └── workspace.css            # 新增：workspace 页面样式
├── views/
│   ├── monitor.html
│   ├── workspace.html           # 新增：workspace 首页模板
│   └── workspace-view.html      # 新增：文件查看页模板
└── server/
    ├── config.js                # 新增：配置加载与默认值
    ├── logger.js                # 新增：滚动日志与清理
    ├── app.js                   # 新增：express app 装配
    ├── routes/
    │   ├── api.js               # 新增：/api /health
    │   └── workspace.js         # 新增：/workspace /workspace/view/*
    ├── services/
    │   └── workspace-page.js    # 新增：workspace 页面数据组装/模板渲染辅助
    ├── parsers/
    │   ├── activity-parser.js   # 新增：session activity 解析主入口
    │   ├── cron-parser.js       # 新增：cron 日志解析
    │   └── tool-call-state.js   # 新增：pendingToolCalls / model snapshot 管理
    ├── watchers/
    │   └── session-watcher.js   # 新增：文件监听与增量读取
    ├── store/
    │   └── activity-store.js    # 新增：recentActivities / cronActivities 管理
    ├── monitor-store.js         # 过渡层，逐步瘦身
    ├── system-stats.js
    └── workspace.js
```

> 注：这是目标结构，不要求一次性全落地。按阶段推进。

---

## 分阶段实施计划

## Phase 1：拆薄 `index.js`（最高优先级）

### 目标
让 `index.js` 回归“启动入口”，不再承载大段页面模板和杂项初始化逻辑。

### 改造项

#### 1. 抽离配置模块
新增：`server/config.js`

职责：
- 读取 `config.json`
- 合并 env 与默认值
- 导出统一 `CONFIG`

建议接口：
```js
const { loadConfig } = require('./server/config');
const CONFIG = loadConfig();
```

#### 2. 抽离日志模块
新增：`server/logger.js`

职责：
- `ensureLogDir()`
- `writeRollingLog(level, message)`
- `cleanupOldLogs()`
- `startLogCleanupScheduler()`

收益：
- API metrics logging 不再和 entry 搅在一起
- 后续可以统一日志策略

#### 3. 抽离 app 装配
新增：`server/app.js`

职责：
- 创建 express app
- 注册 static middleware
- 注册路由
- 返回 app

#### 4. 抽离 API 路由
新增：`server/routes/api.js`

职责：
- `/api`
- `/health`

依赖注入：
- `monitorStore`
- `logger`
- `getSystemStats`（如果需要）

#### 5. 抽离 Workspace 路由
新增：`server/routes/workspace.js`

职责：
- `/workspace`
- `/workspace/view/*`

要求：
- 保持现有 URL 不变
- 保持页面功能不变
- 页面 HTML 不再直接内嵌在 route handler 中

#### 6. 抽离 Workspace 模板
新增：
- `views/workspace.html`
- `views/workspace-view.html`
- `public/workspace.css`
- `public/workspace.js`

说明：
- 先允许使用简单字符串占位替换，不强行引入模板引擎
- 目标是**把 HTML/CSS/JS 从 `index.js` 挪出去**，不是引入额外框架

### Phase 1 验收标准
- `index.js` 明显瘦身，最好压到 **200 行以内**，最多不超过 **300 行**
- `/`、`/api`、`/health`、`/workspace`、`/workspace/view/*` 行为保持一致
- 页面可正常打开，文件树可展开，文件可查看，移动端切换逻辑正常
- 无新增运行依赖（除非确有必要）

---

## Phase 2：拆分 `public/monitor.js`

### 目标
把前端大单文件拆成“状态 / 数据处理 / 渲染 / 轮询 / 交互”几个清晰模块。

### 建议拆分

#### 1. `public/modules/formatters.js`
包含：
- `formatTime`
- `formatDuration`
- `formatTokens`
- `getActivityKey`

#### 2. `public/modules/state.js`
包含：
- `latestActivities`
- `errorAggregateMode`
- `pollCount`
- `lastRenderedSignature`
- `lastServerTimestamp`
- `newFlashKeys`
- `POLL_CONFIG`
- UI state 持久化

#### 3. `public/modules/filters.js`
包含：
- `isErrorActivity`
- `applyFilters`
- `aggregateErrorActivities`
- `updateMetrics`

#### 4. `public/modules/render.js`
包含：
- `createActivityItem`
- `updateAgents`
- `renderFilteredList`
- `updateList`
- `openDetail`
- drawer 相关 UI 逻辑

#### 5. `public/modules/poller.js`
包含：
- `poll`
- `switchToFastMode`
- 轮询定时器管理

#### 6. `public/modules/system-panel.js`
包含：
- `updateSystemPanel`

### 实施策略
- 可以先按“文件内函数分组 + CommonJS/ESM 模块化”拆
- 不强求引入 bundler
- 如果浏览器端模块化成本高，可先拆为多个 `<script>` 文件，再进阶为 ESM

### Phase 2 验收标准
- `public/monitor.js` 降为主入口或装配脚本
- 核心逻辑分散到多个职责明确的模块
- 页面表现和现有版本一致
- 轮询、过滤、聚合、详情抽屉功能不回退

---

## Phase 3：重构 `server/monitor-store.js`

### 目标
把“解析 / 监听 / 存储 / 聚合输出”四类职责拆开。

### 建议拆分

#### 1. Parser 层
新增：
- `server/parsers/activity-parser.js`
- `server/parsers/cron-parser.js`
- `server/parsers/tool-call-state.js`

职责：
- 新格式/旧格式兼容解析
- toolCall 与 toolResult 状态配对
- model snapshot 状态跟踪
- 输出统一 activity 对象

#### 2. Watcher 层
新增：`server/watchers/session-watcher.js`

职责：
- `fs.watch` 监听
- 增量读取新增内容
- 解析新行后回调写入 store

#### 3. Store 层
新增：`server/store/activity-store.js`

职责：
- 管理 `recentActivities` / `cronActivities`
- 控制上限、去旧、查询、时间过滤
- 提供 `getStatus(since)` 需要的原始数据

#### 4. `monitor-store.js` 变协调器
职责变成：
- init 流程编排
- 依赖组装
- 定时 refresh 最新 session / cron run
- 对外暴露 `init/getStatus/getActiveSessionsCount`

### Phase 3 验收标准
- `monitor-store.js` 下降到 **200~250 行以内**
- `parseActivityLine()` 不再是超大函数
- watcher、parser、store 边界清晰
- 支持现有日志格式，不引入兼容性回归

---

## Phase 4：补齐可维护性基础设施（可选但推荐）

### 1. 增加最小回归测试
优先测这些纯逻辑：
- activity parser（新旧格式）
- cron parser
- error aggregate
- filter logic
- format helpers

### 2. 增加样例数据夹具
新增：
```text
test/fixtures/
  session-new-format.jsonl
  session-old-format.jsonl
  cron-run.jsonl
```

### 3. 增加重构后文档
更新：
- `README.md`（如果有）
- 模块结构说明
- 页面路由说明
- 数据流说明

---

## 推荐执行顺序

### 第一轮（本次建议直接做）
1. 抽 `server/config.js`
2. 抽 `server/logger.js`
3. 抽 `server/routes/api.js`
4. 抽 `server/routes/workspace.js`
5. 抽 `views/workspace.html` / `views/workspace-view.html`
6. 抽 `public/workspace.css` / `public/workspace.js`
7. 瘦身 `index.js`

### 第二轮
1. 拆 `public/monitor.js`
2. 把 drawer / filters / polling 分层

### 第三轮
1. 拆 `server/monitor-store.js`
2. 提取 parser / watcher / store

---

## 风险与注意事项

### 1. 先不要改 URL 和接口结构
以下路径应保持不变：
- `/`
- `/api`
- `/health`
- `/workspace`
- `/workspace/view/*`

### 2. 先不要引入重量级模板引擎
当前需求只是“把内联模板挪出去”，不是上 SSR 架构。
优先用：
- 静态 html + 字符串插值
- 或最轻量模板方案

### 3. 监控数据结构不要先动
前后端当前已联通，重构第一原则是**不破坏活动对象结构**。
如：
- `type`
- `agent`
- `sessionName`
- `tool`
- `description`
- `timestamp`
- `model`
- `usage`
- `durationMs`
- `exitCode`
- `status`

### 4. `monitor-store` 先拆函数，再拆行为
不要一上来同时改：
- 解析协议
- watcher 机制
- 数据结构
- 输出接口

这样风险会叠加，回归难查。

---

## 预期收益

完成 Phase 1~3 后，预期收益：
- `index.js` 从“巨型入口文件”变成“可读的启动装配文件”
- Workspace 页面修改不再影响 server entry
- 前端监控逻辑更易维护和扩展
- parser / watcher / store 边界清晰，后续支持更多事件类型更稳
- 代码审查成本下降，未来更容易让其他 agent 接手局部模块

---

## 建议的最终验收口径

### 结构层
- 入口薄
- 路由独立
- 页面模板独立
- 前端逻辑按职责拆分
- 监控核心按 parser / watcher / store 分层

### 功能层
- 现有监控页面行为完全保留
- 现有 workspace 页面行为完全保留
- 现有 API 返回结构完全兼容

### 工程层
- 更容易定位问题
- 更容易加功能
- 更容易测试
- 更容易交给其他 agent 协作开发

---

## 一句话决策

**先拆 `index.js`，把 Workspace 页面从入口文件里彻底剥离；再拆前端监控脚本；最后整理 monitor-store 内核。**

这是当前收益最高、风险最低的重构路径。
