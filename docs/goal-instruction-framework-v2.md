# Goal 指令框架 v2.0 - 打通链路完整指南

> 本框架为 cli-bridge 项目提供目标-指标-边界的完整定义，解决 ChatGPT Web ↔ WorkBuddy ↔ Claude/Codex 链路打通问题。

---

## 一、目标 (Objectives)

### 1.1 核心目标

| ID | 目标 | 描述 | 优先级 |
|----|------|------|--------|
| **O1** | 端到端链路打通 | ChatGPT Web → Bridge API → WorkBuddy → Claude/Codex 执行 → 返回结果 | P0 |
| **O2** | 多执行器混合编排 | Claude + Codex 双轨执行，根据任务类型智能路由 | P1 |
| **O3** | 任务队列可见性 | WorkBuddy 任务状态实时同步到 Bridge Panel | P1 |
| **O4** | 断线自恢复 | ChatGPT Web Source Relay 断线自动重连 | P1 |

### 1.2 链路阶段目标

```
阶段 1: 指令接入
├── 输入: ChatGPT Web 自然语言指令
├── 处理: Source Relay 解析并转发到 Bridge API
└── 指标: 指令解析成功率 ≥ 95%

阶段 2: Goal 生成
├── 输入: 解析后的指令
├── 处理: GoalOrchestrator 生成 Plan
└── 指标: Plan 生成成功率 ≥ 90%

阶段 3: 执行分发
├── 输入: 审批后的 Plan
├── 处理: ExecutionDispatcher 路由到 Claude/Codex
└── 指标: 分发成功率 ≥ 95%

阶段 4: 任务执行
├── 输入: 分发的任务
├── 处理: WorkBuddy 任务队列 + Claude/Codex 执行
└── 指标: 执行成功率 ≥ 90%

阶段 5: 结果回传
├── 输入: 执行结果
├── 处理: Source Relay 回传到 ChatGPT Web
└── 指标: 回传成功率 ≥ 95%
```

### 1.3 执行器职责边界

| 执行器 | 职责 | 输入 | 输出 |
|--------|------|------|------|
| **Claude Code** | 复杂代码任务、文件操作、多步骤规划 | `/plan` 或 `/review` 命令 | 任务结果 + 执行证据 |
| **Codex** | 快速代码补全、轻量级任务 | Review Command | 代码片段 + 状态 |
| **WorkBuddy** | 任务队列管理、长时间任务托管 | Task Inbox Pull | 任务结果 + 耗时 |

---

## 二、指标 (Metrics)

### 2.1 核心链路指标

| 指标 | 定义 | 目标值 | 告警阈值 | 采集方式 |
|------|------|--------|----------|----------|
| **链路完成率** | Goal 从创建到完成的成功率 | ≥ 90% | < 80% | `AutomationLoopRun.status` |
| **循环心跳** | Loop 最后活跃时间距现在 | < 5 分钟 | > 5 分钟 | `updatedAt` |
| **无进展计数** | 连续相同 progressHash 的次数 | < 3 | ≥ 3 | `noProgressCount` |
| **任务队列深度** | WorkBuddy 待处理任务数 | < 20 | > 50 | `inboxCount` |

### 2.2 执行器健康指标

| 执行器 | 就绪状态 | 响应时间 | 错误率 |
|--------|----------|----------|--------|
| **Claude Code** | `executorReady = true` | < 30s | < 5% |
| **Codex** | `executorReady = true` | < 10s | < 5% |
| **WorkBuddy** | `lastClaimedAt` 活跃 | < 5s | < 3% |

### 2.3 Source Relay 诊断指标

| 指标 | 说明 | 正常值 | 异常检测 |
|------|------|--------|----------|
| `sessionActive` | 中继会话是否活跃 | `true` | 断线检测 |
| `lastHeartbeat` | 最后心跳时间 | < 60s | 超时告警 |
| `pendingRequests` | 等待中的请求数 | < 10 | 积压告警 |
| `errorCount` | 错误计数 | 0 | 增长检测 |

### 2.4 性能指标

| 指标 | 目标值 | 测量方式 |
|------|--------|----------|
| 端到端延迟 | < 60s | Goal 创建 → 最后结果返回 |
| Plan 生成时间 | < 10s | GoalOrchestrator.advance() |
| 任务分发延迟 | < 2s | dispatch → 执行器接收 |
| 结果回传延迟 | < 1s | 执行完成 → ChatGPT Web 显示 |

---

## 三、边界 (Boundaries)

### 3.1 功能边界

#### ✅ 允许的操作

```
1. Goal 管理
   - 创建 Goal (自然语言)
   - 查询 Goal 状态
   - 取消/暂停 Goal
   - 审批/拒绝 Plan

2. 执行分发
   - 分发到 Claude Code (review 模式)
   - 分发到 Codex (review 模式)
   - 分发到 WorkBuddy (任务队列)
   - 混合分发 (主备切换)

3. 结果处理
   - 验证执行结果
   - 收集执行证据
   - 回传结果到 ChatGPT Web
   - 自动继续/停止 Loop
```

#### ❌ 禁止的操作

```
1. 安全禁区
   - 跨 project 执行 (必须指定 projectId)
   - 绕过 Plan 审批直接执行
   - 执行未白名单的命令
   - 超过 timeout 的执行

2. 状态禁区
   - Loop 在 terminal 状态后继续
   - 修改已完成 cycle 的状态
   - 重复审批同一个 Gate

3. 资源禁区
   - 单个 Goal 超过 30 分钟
   - 单个 Step 超过 5 分钟
   - 循环次数超过 maxCycles
   - 无进展循环超过 noProgressLimit
```

### 3.2 技术边界

#### 3.2.1 执行器配置

```typescript
// Claude Code 执行器
const CLAUDE_CODE_CONFIG = {
  transport: 'cli' as const,
  command: 'claude',
  args: ['--print', '--output-format', 'stream-json'],
  reviewMode: true,      // 工具禁用
  planMode: false,       // 非 plan 模式
  timeoutMs: 300_000,    // 5 分钟
};

// Codex 执行器
const CODEX_CONFIG = {
  transport: 'cli' as const,
  command: 'codex',
  args: ['--review'],
  reviewMode: true,
  timeoutMs: 180_000,    // 3 分钟
};

// WorkBuddy 执行器
const WORKBUDDY_CONFIG = {
  transport: 'workbuddy' as const,
  inboxPullInterval: 5000,  // 5 秒
  heartbeatInterval: 30000, // 30 秒
  timeoutMs: 600_000,       // 10 分钟
};
```

#### 3.2.2 数据流边界

```
[ChatGPT Web]
      │
      ▼
[Source Relay] ──→ [Bridge API]
      │                 │
      ▼                 ▼
[诊断面板]        [Goal Store]
                           │
                           ▼
                    [GoalOrchestrator]
                           │
                           ▼
                    [Execution Dispatcher]
                           │
          ┌────────────────┼────────────────┐
          ▼                ▼                ▼
    [Claude Code]    [Codex]       [WorkBuddy]
          │                │                │
          └────────────────┴────────────────┘
                           │
                           ▼
                    [结果回传]
                           │
                           ▼
                    [Source Relay] ──→ [ChatGPT Web]
```

#### 3.2.3 存储边界

| 存储 | 容量限制 | 持久化 | 清理策略 |
|------|----------|--------|----------|
| InMemoryGoalStore | 无限制 | JSON Snapshot | 完成后保留 24h |
| InMemoryAutomationLoopStore | 无限制 | JSON Snapshot | 完成后保留 24h |
| Source Relay Session | 100 sessions | Memory | 过期 30min |

### 3.3 权限边界

| 角色 | 能力 |
|------|------|
| **Viewer** | 查看 Goal/Plan 状态、诊断信息 |
| **Operator** | 创建 Goal、审批 Plan、取消执行 |
| **Admin** | 修改执行器配置、管理白名单、强制停止 |

### 3.4 Loop 状态机

```
                    ┌─────────────┐
                    │   draft     │
                    └──────┬──────┘
                           │ start()
                           ▼
┌────────────────────────────────────────────────────────┐
│                                                        │
│   ┌─────────┐     ┌─────────┐     ┌─────────────┐     │
│   │ running │────▶│ waiting │────▶│  running    │     │
│   └────┬────┘     └────┬────┘     └──────┬──────┘     │
│        │               │                 │            │
│        │               │                 │            │
│        ▼               ▼                 ▼            │
│   ┌─────────┐     ┌─────────┐     ┌─────────────┐     │
│   │ paused  │     │  done   │     │   failed    │     │
│   └─────────┘     └─────────┘     └─────────────┘     │
│                                                        │
└────────────────────────────────────────────────────────┘

Terminal States: done | failed | cancelled
```

---

## 四、Goal 指令模板

### 4.1 基础 Goal 指令

```markdown
## Goal 模板

### 目标描述
[用自然语言描述你想要完成的任务]

### 执行约束
- 最大循环次数: [N]
- 执行超时: [X 分钟]
- 允许的执行器: [Claude/Codex/WorkBuddy]

### 验证标准
- [可验证的结果条件]

### 风险边界
- 禁止的操作: [具体列出]
- 回退策略: [失败时的处理方式]
```

### 4.2 执行器选择策略

```typescript
// 执行器路由决策
type ExecutorStrategy = {
  // 简单任务 → Codex
  simpleTask: () => 'codex',
  
  // 复杂任务 → Claude
  complexTask: () => 'claude',
  
  // 长时间任务 → WorkBuddy
  longRunningTask: () => 'workbuddy',
  
  // Claude 失败 → 切换到 Codex
  fallback: () => 'codex',
  
  // 双轨并行 → Claude + Codex
  parallel: () => ['claude', 'codex'],
};

// 决策依据
const TASK_COMPLEXITY = {
  codeCompletion: 'codex',      // 代码补全
  bugFix: 'claude',              // Bug 修复
  refactoring: 'claude',         // 重构
  multiStepPlan: 'claude',       // 多步骤计划
  quickQuery: 'codex',           // 快速查询
  fileOperation: 'claude',       // 文件操作
};
```

### 4.3 断线恢复策略

```typescript
interface RecoveryStrategy {
  // Source Relay 断线
  relayDisconnect: {
    detection: 'heartbeat timeout > 60s',
    action: 'auto-reconnect',
    maxRetries: 5,
    backoffMs: [1000, 2000, 4000, 8000, 16000],
  };
  
  // WorkBuddy 任务丢失
  taskLost: {
    detection: 'result timeout > expected + 30s',
    action: 'resubmit with same dispatchKey',
    maxRetries: 3,
  };
  
  // 执行器无响应
  executorTimeout: {
    detection: 'no heartbeat > timeout',
    action: 'fallback to alternative executor',
    alternatives: ['claude→codex', 'codex→workbuddy'],
  };
}
```

---

## 五、诊断与调试

### 5.1 链路诊断命令

```bash
# 查看当前活跃的 Loop
GET /bridge/loops

# 查看特定 Goal 的链路状态
GET /bridge/goals/:goalId/loop/status

# 查看执行器就绪状态
GET /bridge/executors/status

# 查看 Source Relay 状态
GET /bridge/relay/status

# 手动触发恢复
POST /bridge/relay/reconnect
```

### 5.2 常见问题排查

| 问题 | 诊断命令 | 修复操作 |
|------|----------|----------|
| Loop 卡住 | 检查 `noProgressCount` | 取消后重新创建 |
| 执行器离线 | 检查 `executorReady` | 重启执行器 |
| Source Relay 断线 | 检查 `lastHeartbeat` | 触发重连 |
| 任务堆积 | 检查 `pendingRequests` | 扩容或限流 |
| Gate 审批超时 | 检查 `pendingGateApprovals` | 手动审批或取消 |

---

## 六、实现检查清单

### 6.1 链路打通检查项

- [ ] ChatGPT Web Source Relay 连接稳定
- [ ] Bridge API 正常接收 Source Relay 请求
- [ ] GoalOrchestrator 正确生成 Plan
- [ ] ExecutionDispatcher 正确路由到执行器
- [ ] 执行器正常执行任务
- [ ] 结果正确回传到 ChatGPT Web
- [ ] 诊断面板显示完整链路状态

### 6.2 执行器集成检查项

- [ ] Claude Code Executor 注册成功
- [ ] Codex Executor 注册成功
- [ ] WorkBuddy Executor 注册成功
- [ ] 执行器就绪检测正常
- [ ] 执行器超时处理正常
- [ ] 执行器失败切换正常

### 6.3 监控告警检查项

- [ ] Loop 心跳监控正常
- [ ] 执行器状态监控正常
- [ ] Source Relay 健康监控正常
- [ ] 告警阈值配置正确
- [ ] 告警通知通道畅通

---

## 七、参考文档

- [ADR-0028: Automation Loop 设计](./adr/ADR-0028-automation-loop.md)
- [ADR-0032: WorkBuddy 任务队列](./adr/ADR-0032-workbuddy-queue.md)
- [ADR-0034: 执行器就绪检测](./adr/ADR-0034-executor-readiness.md)
- [ADR-0035: Claude Review 命令集成](./adr/ADR-0035-claude-review.md)
- [Source Relay 文档](./adr/ADR-0035-source-relay-integration.md)

---

*最后更新: 2026-07-06*
*版本: v2.0*
