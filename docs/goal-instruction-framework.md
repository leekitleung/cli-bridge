# Goal 驱动自动化 - 目标指令框架

## 概述

本文档定义了 cli-bridge 项目中 Goal 驱动自动化的目标-指标-边界框架。

---

## 一、目标 (Objectives)

### 1.1 核心目标

**O1: 打通端到端自动化链路**
- 用户输入自然语言 Goal → 系统生成 Plan → 分发执行 → 返回结果
- 覆盖场景：代码开发、文件操作、命令执行

**O2: 支持多执行器路由**
- Claude Code 作为主执行器
- Codex 作为备选/并行执行器
- WorkBuddy 作为任务队列管理

**O3: 确保执行安全与可控**
- Plan 必须经过审批才能执行
- 敏感操作需要 Gate 确认
- 执行结果可验证

### 1.2 子目标

| ID | 子目标 | 描述 |
|----|--------|------|
| S1 | Goal 创建 | 支持通过 UI 或 API 创建 Goal |
| S2 | Plan 生成 | 基于 Goal 自动生成可执行步骤 Plan |
| S3 | Plan 审批 | 用户审批 Plan 后才能执行 |
| S4 | 任务分发 | 将步骤分发到合适的执行器 |
| S5 | 结果收集 | 收集执行结果并更新状态 |
| S6 | 验证反馈 | 验证执行结果是否符合预期 |

---

## 二、指标 (Metrics)

### 2.1 成功指标

| 指标 | 定义 | 目标值 |
|------|------|--------|
| **链路完成率** | Goal 从创建到完成的成功比例 | ≥ 90% |
| **Plan 审批率** | 用户审批 Plan 的比例 | ≥ 80% |
| **步骤成功率** | 单个步骤执行成功的比例 | ≥ 95% |
| **平均完成时间** | Goal 从创建到完成的平均时间 | ≤ 30 分钟 |
| **执行器利用率** | WorkBuddy/Claude/Codex 被调用的比例 | 合理分布 |

### 2.2 健康指标

| 指标 | 定义 | 告警阈值 |
|------|------|----------|
| **循环心跳** | AutomationLoop 活跃度 | 5 分钟无心跳告警 |
| **WorkBuddy 就绪** | 执行器在线状态 | 离线告警 |
| **任务队列深度** | 待处理任务数量 | > 50 告警 |
| **错误率** | 执行失败比例 | > 5% 告警 |

### 2.3 诊断指标

| 指标 | 用途 |
|------|------|
| `lastClaimedAt` | 检测 WorkBuddy 是否活跃 |
| `executorReady` | 检测执行器注册状态 |
| `cycleCount` | 监控循环迭代次数 |
| `noProgressCount` | 检测死锁/卡死状态 |

---

## 三、边界 (Boundaries)

### 3.1 功能边界

#### 3.1.1 允许的操作

```
✓ 创建 Goal (自然语言描述)
✓ 生成 Plan (LLM 驱动)
✓ 审批/拒绝 Plan
✓ 执行步骤 (命令/文件操作)
✓ 验证结果 (stdout/exit code)
✓ 取消 Goal
✓ 暂停/恢复 Plan
```

#### 3.1.2 禁止的操作

```
✗ 跨项目执行 (必须指定 projectId)
✗ 绕过 Plan 审批直接执行
✗ 用户未确认的敏感操作
✗ 超过 timeout 的执行
✗ 非白名单命令执行
```

#### 3.1.3 限制条件

| 限制 | 值 | 说明 |
|------|-----|------|
| `maxCycles` | 10 | 单个 Goal 最大循环次数 |
| `noProgressLimit` | 3 | 无进展循环上限 |
| `verifyTimeoutMs` | 60s | 验证超时 |
| `executionTimeoutMs` | 5min | 单步执行超时 |
| `deadlineAt` | 30min | Goal 整体截止时间 |

### 3.2 技术边界

#### 3.2.1 执行器支持

| 执行器 | 传输方式 | 状态 | 说明 |
|--------|----------|------|------|
| Claude Code | Review Command | ✓ 生产可用 | Review 模式，无工具 |
| Codex | Review Command | ✓ 生产可用 | Review 模式，无工具 |
| WorkBuddy | Pull Inbox | ✓ 生产可用 | 任务队列模式 |
| Claude + Codex 混合 | 路由选择 | 规划中 | 动态选择执行器 |

#### 3.2.2 数据流边界

```
[User] → Goal Store → Plan Generator → [Approval Gate]
                                        ↓
                              Automation Loop Store
                                        ↓
                              Execution Dispatcher
                                        ↓
                    ┌───────────────────┼───────────────────┐
                    ↓                   ↓                   ↓
              Claude Code          Codex             WorkBuddy
                    ↓                   ↓                   ↓
              Review Result     Review Result    Inbox Pull/Result
                    └───────────────────┼───────────────────┘
                                        ↓
                              Goal Store (状态更新)
                                        ↓
                              [User] (结果展示)
```

#### 3.2.3 存储边界

| 存储 | 容量 | 持久化 |
|------|------|--------|
| InMemoryGoalStore | 无限制 | JSON Snapshot |
| InMemoryAutomationLoopStore | 无限制 | JSON Snapshot |
| WorkBuddyExecutionAdapter | 无限制 | JSON Snapshot |

### 3.3 权限边界

| 角色 | 权限 |
|------|------|
| Viewer | 查看 Goal/Plan 状态 |
| Operator | 创建 Goal，审批 Plan |
| Admin | 修改配置，管理执行器 |

---

## 四、核心流程

### 4.1 Goal 生命周期

```
[Draft] → [Planning] → [Awaiting Approval] → [Approved]
                ↓                                  ↓
          [Generating]                      [Executing]
                ↓                                  ↓
          [Planned] ────────────────────→ [Completed/Failed]
```

### 4.2 Automation Loop 流程

```
Tick Loop
    │
    ├─► 检查是否有未完成的任务
    │       │
    │       ├─► 有 → 等待结果 (waiting)
    │       │
    │       └─► 无 → 推进 GoalOrchestrator
    │               │
    │               ├─► noop → blocked
    │               ├─► step-completed → 验证/继续
    │               ├─► step-failed → goal-failed
    │               ├─► step-gated → 等待审批
    │               └─► plan-completed → goal-complete
    │
    └─► 更新 Loop 状态
```

---

## 五、API 端点

### 5.1 Goal 管理

| 方法 | 路径 | 功能 |
|------|------|------|
| POST | `/bridge/goals` | 创建 Goal |
| GET | `/bridge/goals` | 列表 Goals |
| GET | `/bridge/goals/:goalId` | 获取 Goal 详情 |
| POST | `/bridge/goals/:goalId/cancel` | 取消 Goal |
| POST | `/bridge/goals/:goalId/pause` | 暂停 Goal |

### 5.2 Plan 管理

| 方法 | 路径 | 功能 |
|------|------|------|
| POST | `/bridge/goals/plan` | 生成 Plan |
| GET | `/bridge/goals/:goalId/plan` | 获取 Plan |
| POST | `/bridge/goals/:goalId/plan/approve` | 审批 Plan |
| POST | `/bridge/goals/:goalId/plan/reject` | 拒绝 Plan |

### 5.3 执行

| 方法 | 路径 | 功能 |
|------|------|------|
| POST | `/bridge/execution/propose` | 分发执行提案 |
| POST | `/bridge/execution/confirm` | 确认执行 |
| GET | `/inbox/next` | WorkBuddy 拉取任务 |
| POST | `/results` | WorkBuddy 提交结果 |

---

## 六、实现状态

### 6.1 已完成

- [x] Goal Store (InMemoryGoalStore)
- [x] Plan 生成 (GoalOrchestrator)
- [x] WorkBuddy 执行适配器
- [x] Automation Loop Store
- [x] Bridge API 端点
- [x] Project Console UI

### 6.2 进行中

- [ ] Goal Automation Loop 集成
- [ ] 多执行器路由
- [ ] 执行结果验证

### 6.3 待开发

- [ ] Plan 可视化编辑器
- [ ] 执行历史追溯
- [ ] 性能监控面板

---

## 七、参考文档

- ADR-0028: Automation Loop 设计
- ADR-0032: WorkBuddy 任务队列
- ADR-0034: 执行器就绪检测
- ADR-0035: Claude Review 命令集成

---

## 八、附录

### A. 类型定义

```typescript
// Goal 状态
type GoalStatus = 'draft' | 'planning' | 'planned' | 'approved' |
                  'executing' | 'completed' | 'failed' | 'cancelled' | 'paused';

// Plan 状态
type PlanStatus = 'draft' | 'proposed' | 'approved' | 'executing' |
                  'completed' | 'failed' | 'cancelled' | 'paused';

// Step 状态
type StepStatus = 'pending' | 'running' | 'gated' | 'done' | 'failed' | 'skipped';

// Loop 状态
type AutomationLoopStatus = 'draft' | 'running' | 'waiting' | 'paused' |
                            'done' | 'failed' | 'cancelled';

// Cycle 状态
type AutomationLoopCycleStatus = 'planned' | 'dispatching' | 'waiting-result' |
                                  'returned' | 'failed' | 'skipped';
```

### B. 配置文件

```typescript
const DEFAULT_GOAL_PLAN_COMMAND_CONFIG = {
  adapterName: 'goal-plan-generator',
  command: 'claude',
  argv: CLAUDE_REVIEW_ARGS, // 安全参数：工具禁用、plan 模式
};

const DEFAULT_EXECUTION_CONFIG = {
  maxCycles: 10,
  noProgressLimit: 3,
  deadlineAt: 30 * 60 * 1000, // 30 分钟
  verifyTimeoutMs: 60_000,
};
```
