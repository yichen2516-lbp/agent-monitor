# Agent Monitor Phase 5 规划

## 定位

Phase 5 不再是“结构性重构”，而是 **产品体验与可观察性增强阶段**。

前面 Phase 1~4 已完成的重点：
- 拆薄入口与路由层
- 拆分前端 monitor 脚本
- 拆分后端 monitor-store 内核
- 补齐最小自动化回归测试与文档

因此，Phase 5 的目标不是继续大拆，而是：

> **在现有结构已经清晰的前提下，把 Agent Monitor 做得更顺手、更稳、更像一个成品。**

---

## 当前进展（2026-03-13 更新）

### 已完成

#### P5-B：错误与异常定位增强（已落地第一版）
已完成内容：
- 错误聚合增强：
  - 支持按更稳定的 error signature 聚合
  - 展示聚合次数
  - detail drawer 可查看 grouped events
- Slow Calls 视图：
  - summary card 可点击进入慢调用过滤视图
  - 慢调用卡片增加 `SLOW` 标记
- 失败请求专用过滤器：
  - `Failed Tools`
  - `Tool Errors`
  - `Cron Errors`
- 错误详情增强：
  - drawer 增加 summary 区
  - 增加 source / session / event JSON 复制按钮
  - 增加 `Error Kind`、`Tool Status`、`Stop Reason` 等字段

代表提交：
- `19e9924` — `feat(monitor): improve error investigation workflows`

#### P5-C：详情交互与可读性优化（已落地第一版）
已完成内容：
- detail drawer 从纯 JSON 升级为：
  - summary
  - description
  - grouped events
  - raw JSON
- 活动卡片增加更清楚的 tag：
  - duration
  - slow tag
  - aggregate 信息
- copy 交互已接入

说明：
- 这一块已基本达到“可用且顺手”的第一版目标
- 但 usage 展示仍然偏粗，后续还能继续细化

#### P5-D：Workspace Browser 产品化增强（已落地第一版）
已完成内容：
- Workspace UI 与 Monitor 首页风格同步（HUD / cyber dark）
- 首页与文件页共用同一套 sidebar shell
- 文件名搜索
- 当前文件高亮
- 目录展开状态 / 搜索词 / 上次浏览状态记忆
- 文件不存在时，不再返回裸 404 空页，而是在 viewer shell 内展示错误提示
- 图片文件预览支持：
  - 不再把图片按文本读取
  - 不再把图片以 base64 内联进 HTML
  - 改为独立 raw route 加载，降低页面卡死风险
- 二进制文件不再显示乱码文本，改为 binary notice

代表提交：
- `cf2b2b4` — `feat(workspace): UX/UI overhaul with search, state persistence, unified HUD style`
- `ccc46df` — `fix(workspace): correct sidebar styling and search visibility`
- `6fa1adf` — `fix(workspace): render images and guard binary previews`
- `e915430` — `fix(workspace): avoid inline base64 image previews`
- `e6b8159` — `fix(workspace): show missing file errors inside viewer shell`

### 已暴露/已记录的问题

#### Workspace 性能风险（高优先级待处理）
在本轮 Workspace 改造中，已经暴露出以下问题：
- Safari 打开 workspace 页面明显更慢
- 文件树是服务端一次性全量生成 HTML，DOM 体积偏大
- 前端搜索仍是对当前 DOM 做全量遍历
- 当 workspace 规模继续扩大时，仍有再次卡顿风险

结论：
- **P5-D 已经从“可用性问题”走到“性能问题”**
- 下一步不应继续只修样式，而应该开始做减载

---

## 目标

### 总目标
围绕三个方向推进：
1. **更好看懂**：更容易理解当前发生了什么
2. **更好定位**：更快发现错误、慢请求、异常模式
3. **更好操作**：筛选、查看、跳转、排查路径更顺手

### 约束
- 不破坏当前已稳定的页面与 API 主行为
- 不引入重型前端框架
- 尽量做增量优化，避免再次进入大规模结构改造
- 每项优化都应可单独交付

---

## 建议拆成 5 个子方向

## P5-A：监控视图增强

### 目标
让主监控页更适合“盯盘”和“排错”，不只是活动列表滚动。

### 候选项

#### 1. Agent 维度视图
当前：所有活动混在一个 feed 中  
目标：支持按 agent 快速聚焦

可选实现：
- agent 快速 tab / segment
- agent 独立摘要卡片
- 每个 agent 最近活动时间显示

#### 2. Session 维度视图
当前：session 只作为活动卡片里的一个字段  
目标：支持按 session 追踪完整上下文

可选实现：
- session 筛选器
- session drill-down 面板
- session 最近 N 条活动聚合展示

#### 3. 类型视图增强
当前：tool / reply / thinking / cron 仅靠筛选器区分  
目标：支持更清楚的信息层级

可选实现：
- 类型分组显示
- thinking 默认折叠
- tool call / tool result 成对视觉展示

### 预期收益
- 更快锁定“哪个 agent / 哪个 session / 哪类事件”有问题
- 降低活动流刷屏时的信息噪音

---

## P5-B：错误与异常定位增强

### 目标
让 Agent Monitor 从“看日志”升级到“快速识别异常模式”。

### 状态
**第一版已完成，后续进入精修阶段。**

### 已完成
- 错误聚合增强
- 慢调用 quick filter
- 失败请求专用过滤器
- drawer 基础错误上下文增强

### 后续可继续增强
- error group 展示首次时间 / 最近时间 / 次数更完整
- 增加 slow calls 独立列表而不只是过滤态
- duration 阈值配置化
- 错误分组支持更强的 drill-down

---

## P5-C：详情交互与可读性优化

### 目标
让单条活动的阅读体验更好，降低信息挤压感。

### 状态
**第一版已完成，后续可继续细化。**

### 已完成
- drawer 分区结构化
- raw JSON 可折叠查看
- 复制能力
- 错误类字段补充

### 下一步建议
- usage 拆成 input / output / total
- source / session / tool 的 summary 信息再强化
- 长文本可读性继续优化（尤其是 thinking / reply）

---

## P5-D：Workspace Browser 产品化增强

### 目标
把 workspace 页面从“能看”升级到“好用”。

### 状态
**第一版已完成，但性能与稳定性仍需第二轮。**

### 已完成
- 文件名搜索
- 目录状态记忆
- 文件查看增强（图片 / 二进制 / inline error）
- 导航增强（统一 shell / 返回路径更清楚）
- UI 风格同步

### 当前最需要继续做的
#### 1. Workspace 树减载 / 首屏性能优化
建议优先做：
- 默认只渲染前几层目录
- 深层目录改为按需展开加载
- 搜索改为基于轻量索引，而不是全 DOM 遍历

#### 2. 文件查看增强第二轮
- 大文本文件增加截断与“继续展开”机制
- 图片增加自然尺寸 / 分辨率信息
- 非文本文件增加下载/原文件打开入口（如果需要）

#### 3. 导航增强第二轮
- 上一个 / 下一个文件
- 最近打开文件列表
- 更好的 breadcrumb 跳转体验

### 预期收益
- 真正解决 Safari 慢、页面卡顿风险
- 让 workspace 不只是“能用”，而是“长期可挂着用”

---

## P5-E：性能与可观察性增强

### 目标
在功能稳定基础上，把“更稳、更省、更可追踪”补上。

### 候选项

#### 1. API 指标增强
- `/api` 请求计数更结构化
- 增加 error count / avg latency / p95（后续可选）
- 服务启动后累计指标面板

#### 2. 前端渲染优化
- 降低无意义重绘
- 大量活动下的渲染性能优化
- 过滤器变更时减少 DOM 抖动

#### 3. Polling 策略优化
- 根据页面活跃状态降频
- 页面失焦时降低刷新率
- 可选的“暂停刷新”按钮

#### 4. 向 WebSocket 演进的预研
不是现在必须做，但可以记录方向：
- 先保留 polling
- 后续评估 websocket 推送是否值得

### 预期收益
- 更适合长期挂着监控
- 页面更稳，资源消耗更低

---

## 建议优先级（更新后）

### 当前建议优先级
1. **P5-D 第二轮：Workspace 性能减载**
2. **P5-C 第二轮：drawer / usage 信息细化**
3. **P5-A：Agent / Session 维度视图增强**
4. **P5-E：前端渲染与 polling 优化**

### 为什么这样排
- monitor 主页这轮已经从“能看”升级到“好排错”
- 当前最明显的实际痛点，已经转移到 **workspace 的性能与稳定性**
- 如果不先处理 P5-D 第二轮，workspace 页后面会持续冒出“卡 / 慢 / 树太重”的问题

---

## 建议的下一批任务（更新版）

### Task 5：Workspace 树减载
- 默认只展开有限层级
- 深层目录按需加载或按需渲染
- 避免首页生成过重 DOM

### Task 6：Workspace 搜索轻量化
- 从“遍历所有 DOM 节点”改为“基于索引过滤”
- 降低 Safari 卡顿概率

### Task 7：Drawer usage 细化
- input / output / total tokens 分开展示
- provider / model / stopReason 归一化展示

### Task 8：Session 视图增强
- 增加 session 过滤器或 session drill-down
- 让排查一段完整会话更顺手

---

## 验收标准

Phase 5 不适合用“文件有没有拆完”来验收，而应该用用户价值来验收：

### 好的验收方式
- 出错时能否更快定位问题
- 活动流是否更容易读
- 详情信息是否更完整
- workspace 是否更顺手
- 长期开着是否更稳

### 不好的验收方式
- 只是代码更多了
- UI 更花了
- 做了很多但没有提升排错效率

---

## 一句话结论（更新）

**Phase 5 已经完成了 monitor 排错能力第一轮升级，并完成了 workspace 的第一轮产品化。**

**下一步最应该做的，不是再堆新样式，而是处理 workspace 的性能减载与稳定性问题。**
