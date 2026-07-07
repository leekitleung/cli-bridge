# Goal 链路优化实验框架

**实验总数目标**: 25+ 次实验  
**主导模型**: Opus（统筹优化研究）  
**实验周期**: 持续迭代，直到链路稳定且成本优化达标

---

## 📋 实验记录模板

每个实验开始前必须填写：

```markdown
## Exp-XX: [实验名称]

**日期**: YYYY-MM-DD  
**假设**: [具体假设，预期结果]
**变量**: [操控的自变量]
**基线**: [对比的基准]
**预期**: [假设成立时的预期输出]
**实际**: [实验完成后的实际输出]
**结论**: [假设是否成立]
**失败路线**: [如果失败，原因分析]
```

---

## 🎯 实验总览

| 批次 | 主题 | 实验数 | 优先级 |
|------|------|--------|--------|
| **A** | 链路基础打通 | 5 | P0 |
| **B** | WorkBuddy 集成 | 5 | P0 |
| **C** | 执行器路由 | 5 | P1 |
| **D** | 成本优化 | 5 | P1 |
| **E** | 用户体验 | 5 | P2 |

---

## 🔬 批次 A: 链路基础打通 (Exp-01 ~ Exp-05)

### Exp-01: Goal 创建 → Plan 生成 完整链路

**假设**: 通过 Bridge API 创建 Goal 后，GoalOrchestrator 能正确推进状态并生成 Plan

**变量**:
- `sessionId`: 有效的 CLI Bridge session
- `description`: 简单的 "在 /tmp 目录创建测试文件"
- `plannerSource`: "model-api"

**基线**: 无（首次实验）

**预期**:
```
Goal status: draft → planning → planned
Plan steps: 1-2 个步骤
Plan status: proposed
```

**实际**: ___（待填写）

**结论**: ___/待验证

**失败路线**:
- ❌ GoalStore.createGoal 抛出异常 → 检查 sessionId 验证逻辑
- ❌ GoalOrchestrator.advance 返回 noop → 检查 goal status 转换
- ❌ Plan 步骤为空 → 检查 model-api plan generator

---

### Exp-02: Plan 审批后执行流程

**假设**: 用户审批 Plan 后，AutomationLoop 能正确分发任务到执行器

**变量**:
- `goalId`: Exp-01 创建的 goal
- `approval`: approve action

**基线**: Exp-01 的 Goal

**预期**:
```
Plan status: approved
AutomationLoop status: running
Cycle status: dispatched
```

**实际**: ___

**结论**: ___

**失败路线**:
- ❌ 审批 API 返回 409 → 检查 goal/plan 状态机
- ❌ Loop 未创建 → 检查 bridge-api 审批逻辑
- ❌ Cycle 未分发 → 检查 execution dispatcher

---

### Exp-03: 单步骤执行成功路径

**假设**: WorkBuddy 能接收并处理一个简单的 read-only 任务

**变量**:
- `taskType`: "diagnostic" (read-only)
- `prompt`: "返回系统当前时间戳"

**基线**: Exp-02 的执行环境

**预期**:
```
Task status: pending → claimed → returned
Result.ok: true
Result.stdout: ISO 时间戳
```

**实际**: ___

**结论**: ___

**失败路线**:
- ❌ WorkBuddy 未启动 → 启动 worker 进程
- ❌ Inbox 为空 → 检查 enqueue 逻辑
- ❌ 超时 → 增加 timeoutMs 或检查 worker 轮询

---

### Exp-04: 执行失败与错误恢复

**假设**: 当执行失败时，系统能正确记录失败状态并停止循环

**变量**:
- `taskType`: "failing" (故意返回失败)
- `expectedFailure`: true

**基线**: Exp-03 的环境

**预期**:
```
Task status: returned
Result.ok: false
Goal status: failed
Loop status: done (reason: action-failed)
```

**实际**: ___

**结论**: ___

**失败路线**:
- ❌ 失败状态未传播 → 检查 result 处理逻辑
- ❌ Loop 继续运行 → 检查 stop conditions
- ❌ 错误信息丢失 → 检查 audit log

---

### Exp-05: 链路状态可视化

**假设**: Project Console 能正确展示 Goal/Plan/Loop 的实时状态

**变量**:
- `endpoint`: /console/project
- `pairingToken`: 有效 token

**基线**: 前 4 个实验的状态

**预期**:
```
- Goal 卡片显示正确状态
- Plan 步骤列表完整
- Loop 进度指示器活跃
- 诊断信息面板正常
```

**实际**: ___

**结论**: ___

**失败路线**:
- ❌ 状态不更新 → 检查 SSE/polling 机制
- ❌ UI 布局错乱 → 检查 CSS/响应式
- ❌ 数据缺失 → 检查 API 响应格式

---

## 🔬 批次 B: WorkBuddy 集成 (Exp-06 ~ Exp-10)

### Exp-06: WorkBuddy 心跳与就绪检测

**假设**: WorkBuddy 的 `executorReady` 信号能正确反映 worker 进程状态

**变量**:
- `heartbeatInterval`: 30 秒
- `maxStaleMs`: 120 秒

**基线**: Exp-03 的 WorkBuddy

**预期**:
```
getExecutorReady(): true
getLastHeartbeatAt(): > 0
isReady(): true
```

**实际**: ___

**结论**: ___

**失败路线**:
- ❌ Worker 未注册 → 检查 /heartbeat 端点
- ❌ 心跳丢失 → 检查网络稳定性
- ❌ 状态不同步 → 检查 adapter 内部状态

---

### Exp-07: 任务队列深度监控

**假设**: 当队列积压时，系统能检测并告警

**变量**:
- `enqueueCount`: 10 个任务
- `workerDelay`: 停止 worker 30 秒

**基线**: Exp-06 的 WorkBuddy

**预期**:
```
Pending tasks: 10
Queue depth alert: triggered (> 50 阈值)
Recovery: worker 恢复后队列清空
```

**实际**: ___

**结论**: ___

**失败路线**:
- ❌ 告警未触发 → 检查阈值逻辑
- ❌ 队列未清空 → 检查 worker 重试机制
- ❌ 任务丢失 → 检查 persistence

---

### Exp-08: 任务超时与优雅降级

**假设**: 长时间运行的任务能正确超时并记录

**变量**:
- `timeoutMs`: 5000 (5 秒)
- `taskDuration`: 10 秒

**基线**: Exp-06 的 WorkBuddy

**预期**:
```
Task status: claimed → (超时) → failed
Result.failureReason: "timeout after 5000ms"
Loop action-failed: triggered
```

**实际**: ___

**结论**: ___

**失败路线**:
- ❌ 超时未触发 → 检查 worker timeout 逻辑
- ❌ 任务继续运行 → 检查 abort signal
- ❌ 失败状态错误 → 检查 error classification

---

### Exp-09: WorkBuddy 断线重连

**假设**: WorkBuddy 断线后重新连接，能继续处理队列

**变量**:
- `disconnectDuration`: 60 秒
- `pendingTasks`: 5 个

**基线**: Exp-07 的队列状态

**预期**:
```
Disconnect: getExecutorReady() → false
Reconnect: tasks processed in order
No task loss or duplication
```

**实际**: ___

**结论**: ___

**失败路线**:
- ❌ 任务丢失 → 检查 persistence
- ❌ 重复执行 → 检查 idempotency key
- ❌ 状态不一致 → 检查 adapter hydration

---

### Exp-10: WorkBuddy 与 Claude 并行执行

**假设**: 可以同时使用 WorkBuddy 和 Claude Review Command

**变量**:
- `taskA`: WorkBuddy (diagnostic)
- `taskB`: Claude Review Command (read-only)

**基线**: 前 9 个实验

**预期**:
```
Both tasks complete
No resource contention
Distinct result formats
```

**实际**: ___

**结论**: ___

**失败路线**:
- ❌ 资源争用 → 隔离执行器资源
- ❌ 结果混淆 → 检查 routing key
- ❌ 死锁 → 检查并发控制

---

## 🔬 批次 C: 执行器路由 (Exp-11 ~ Exp-15)

### Exp-11: Claude Code 作为执行器

**假设**: Claude Review Command 能处理 read-only 任务

**变量**:
- `adapterName`: "claude-code-command"
- `taskType`: "read-only"

**基线**: 无

**预期**:
```
Command adapter created
Review result returned
No tool execution
```

**实际**: ___

**结论**: ___

**失败路线**:
- ❌ CLI 未安装 → 提示安装 claude
- ❌ 命令超时 → 检查 CLAUDE_REVIEW_ARGS
- ❌ 权限拒绝 → 检查 auth flow

---

### Exp-12: Codex 作为执行器

**假设**: Codex Review Command 能处理 read-only 任务

**变量**:
- `adapterName`: "codex-command"
- `taskType`: "read-only"

**基线**: Exp-11

**预期**:
```
Command adapter created
Review result returned
No tool execution
```

**实际**: ___

**结论**: ___

**失败路线**:
- ❌ CLI 未安装 → 提示安装 codex
- ❌ 命令失败 → 检查 OPENAI_API_KEY
- ❌ 结果格式不同 → 统一 adapter 接口

---

### Exp-13: 执行器智能路由选择

**假设**: 系统能根据任务类型自动选择最优执行器

**变量**:
- `taskType`: "diagnostic" | "read-only" | "structured"
- `executorPreference`: "auto" | "claude" | "codex" | "workbuddy"

**基线**: Exp-11, Exp-12

**预期**:
```
diagnostic → workbuddy
read-only → claude/codex (随机或负载)
structured → workbuddy (with review)
```

**实际**: ___

**结论**: ___

**失败路线**:
- ❌ 路由规则错误 → 检查 routing table
- ❌ 执行器不可用 → 检查 fallback
- ❌ 选择非最优 → 收集性能数据优化

---

### Exp-14: 多执行器负载均衡

**假设**: 多个相同类型任务能均匀分配到可用执行器

**变量**:
- `taskCount`: 20
- `executorPool`: [claude, codex, workbuddy]

**基线**: Exp-13

**预期**:
```
Task distribution: ~7-7-6
No executor overload
Average completion time: balanced
```

**实际**: ___

**结论**: ___

**失败路线**:
- ❌ 分配不均 → 检查 round-robin 实现
- ❌ 某些执行器空闲 → 检查 capacity 检测
- ❌ 任务堆积 → 增加并发度

---

### Exp-15: 执行器降级与熔断

**假设**: 当执行器持续失败时，系统能自动降级到备选

**变量**:
- `failureThreshold`: 3 次连续失败
- `executor`: "claude"

**基线**: Exp-14

**预期**:
```
3 failures → executor marked degraded
Next task → routed to fallback
Recovery → auto re-enable after N successes
```

**实际**: ___

**结论**: ___

**失败路线**:
- ❌ 降级未触发 → 检查 failure counter
- ❌ 备选不可用 → 检查 fallback chain
- ❌ 假阳性降级 → 调整阈值或添加 cooldown

---

## 🔬 批次 D: 成本优化 (Exp-16 ~ Exp-20)

### Exp-16: 模型选择成本分析

**假设**: 不同模型有不同的成本/性能比，需要根据任务选择

**变量**:
- `models`: [haiku, sonnet, opus]
- `taskComplexity`: [low, medium, high]

**基线**: 使用 Opus 处理所有任务

**预期**:
```
Low complexity → Haiku (节省 ~90% 成本)
Medium complexity → Sonnet (节省 ~50% 成本)
High complexity → Opus
```

**实际**: ___

**结论**: ___

**失败路线**:
- ❌ 模型选择错误 → 调整分类器
- ❌ 性能下降明显 → 回退到更高模型
- ❌ 成本计算错误 → 验证 API pricing

---

### Exp-17: Plan 精简优化

**假设**: 通过优化 prompt，可以让 Plan 步骤减少

**变量**:
- `originalPrompt`: 基线 prompt
- `optimizedPrompt`: 添加 "保持简洁" 指令

**基线**: 当前 plan 生成 prompt

**预期**:
```
Average steps: 8 → 5
Completion rate: maintained
User satisfaction: improved
```

**实际**: ___

**结论**: ___

**失败路线**:
- ❌ 步骤过少导致执行失败 → 回退
- ❌ 步骤过多 → 继续优化 prompt
- ❌ 质量下降 → 平衡精简与完整性

---

### Exp-18: 缓存复用优化

**假设**: 相同或相似的 Goal 可以复用之前的 Plan

**变量**:
- `similarGoalThreshold`: 0.8 相似度
- `cacheStrategy`: "plan" | "step" | "none"

**基线**: 无缓存

**预期**:
```
Cache hit rate: > 30%
Plan generation cost: -40%
Execution quality: maintained
```

**实际**: ___

**结论**: ___

**失败路线**:
- ❌ 缓存命中错误 → 调整相似度算法
- ❌ 过期数据问题 → 添加 TTL
- ❌ 质量不一致 → 验证一致性

---

### Exp-19: 批量操作合并

**假设**: 连续的多个步骤可以合并为单个批量操作

**变量**:
- `batchSize`: 3-5 个步骤
- `batchStrategy`: "auto" | "manual"

**基线**: 逐个执行

**预期**:
```
API calls: -60%
Latency: -40%
Cost: -50%
```

**实际**: ___

**结论**: ___

**失败路线**:
- ❌ 批量失败影响大 → 添加 rollback
- ❌ 难以调试 → 增加 batch 可见性
- ❌ 资源占用高 → 限制 batch 大小

---

### Exp-20: 空闲资源利用

**假设**: 在低负载时使用更激进的优化策略

**变量**:
- `loadThreshold`: 30% 利用率
- `aggressiveMode`: boolean

**基线**: 固定策略

**预期**:
```
Low load: aggressive caching + batch
High load: conservative, prioritize throughput
Cost variance: reduced
```

**实际**: ___

**结论**: ___

**失败路线**:
- ❌ 负载判断错误 → 改进监控
- ❌ 模式切换延迟 → 添加快速切换
- ❌ 资源竞争 → 隔离策略

---

## 🔬 批次 E: 用户体验 (Exp-21 ~ Exp-25)

### Exp-21: 实时进度反馈

**假设**: 用户能看到实时的任务进度

**变量**:
- `updateInterval`: 1 秒
- `displayFormat`: "progress" | "timeline" | "summary"

**基线**: 仅最终结果

**预期**:
```
Step progress: visible
Estimated time: shown
Current step: highlighted
```

**实际**: ___

**结论**: ___

**失败路线**:
- ❌ 延迟过高 → 优化推送机制
- ❌ 界面闪烁 → 添加 debounce
- ❌ 信息过载 → 精简显示

---

### Exp-22: 错误上下文呈现

**假设**: 错误发生时，用户能理解原因并知道如何解决

**变量**:
- `errorType`: "timeout" | "auth" | "resource" | "logic"
- `displayFormat`: "inline" | "modal" | "panel"

**基线**: 仅错误码

**预期**:
```
Error message: human readable
Root cause: explained
Suggested action: provided
```

**实际**: ___

**结论**: ___

**失败路线**:
- ❌ 信息不足 → 增强错误分类
- ❌ 误导信息 → 验证错误诊断
- ❌ 界面混乱 → 优化布局

---

### Exp-23: 撤销与回滚

**假设**: 用户可以撤销已执行的操作或回滚到之前状态

**变量**:
- `undoDepth`: 5 步
- `rollbackCheckpoint`: "goal" | "plan" | "step"

**基线**: 无撤销

**预期**:
```
Undo available: true
Rollback time: < 2s
State consistency: maintained
```

**实际**: ___

**结论**: ___

**失败路线**:
- ❌ 不可逆操作 → 标记为不可撤销
- ❌ 状态不一致 → 添加事务保证
- ❌ 性能开销 → 延迟化撤销

---

### Exp-24: 快捷命令与模板

**假设**: 用户可以快速执行常见任务

**变量**:
- `templates`: 5 个预设模板
- `shortcuts`: 3 个快捷键

**基线**: 仅自由输入

**预期**:
```
Task creation time: -50%
Common tasks: 1-click
Customization: user-defined
```

**实际**: ___

**结论**: ___

**失败路线**:
- ❌ 模板不适配 → 添加自定义
- ❌ 学习成本高 → 渐进式引导
- ❌ 灵活性下降 → 保持自由输入

---

### Exp-25: 多语言与国际化

**假设**: 用户可以用不同语言与系统交互

**变量**:
- `languages`: ["zh-CN", "en-US", "ja-JP"]
- `detection`: "auto" | "manual"

**基线**: 仅英语

**预期**:
```
Language detection: accurate
Response: localized
Mixed language: supported
```

**实际**: ___

**结论**: ___

**失败路线**:
- ❌ 检测错误 → 添加手动切换
- ❌ 翻译质量差 → 使用专业翻译
- ❌ 术语不一致 → 建立术语表

---

## 📊 成本优化专题实验 (Exp-26 ~ Exp-30+)

### Exp-26: Opus 统筹模式成本分析

**假设**: 使用 Opus 统筹所有实验能获得最佳优化结果

**变量**:
- `orchestrator`: Opus
- `researchDepth`: "shallow" | "medium" | "deep"

**基线**: Sonnet 统筹

**预期**:
```
Optimization coverage: +40%
Quality improvement: +20%
Cost overhead: +150% (值得吗？)
```

**实际**: ___

**结论**: ___

**失败路线**:
- ❌ 成本过高 → 限制 Opus 使用场景
- ❌ 效果不明显 → 评估优化有效性
- ❌ 延迟过高 → 添加异步模式

---

### Exp-27: Sonnet 作为 Plan 生成器

**假设**: Sonnet 足以生成高质量 Plan，成本比 Opus 低

**变量**:
- `planner`: Sonnet 4
- `taskComplexity`: [low, medium]

**基线**: Opus 作为 planner

**预期**:
```
Plan quality: 95% 相当
Cost: -60%
Latency: -30%
```

**实际**: ___

**结论**: ___

**失败路线**:
- ❌ 质量下降明显 → 回退到 Opus
- ❌ 失败率上升 → 添加 fallback
- ❌ 用户不满 → 调整阈值

---

### Exp-28: Haiku 作为验证层

**假设**: Haiku 可以用于轻量级结果验证

**变量**:
- `verifier`: Haiku
- `taskType`: "simple-check"

**基线**: 无验证层

**预期**:
```
Verification accuracy: > 90%
Cost: -80% vs Sonnet
Latency: -70%
```

**实际**: ___

**结论**: ___

**失败路线**:
- ❌ 误判率高 → 回退到 Sonnet
- ❌ 遗漏问题 → 添加二次验证
- ❌ 不适用复杂场景 → 分场景选择

---

### Exp-29: 混合模型流水线

**假设**: 不同阶段使用不同模型，整体成本最优

**变量**:
- `stages`: [Haiku→Sonnet→Opus]
- `routingLogic`: 基于复杂度

**基线**: 全程 Opus

**预期**:
```
Cost: -70%
Quality: 98% 相当
Latency: -40%
```

**实际**: ___

**结论**: ___

**失败路线**:
- ❌ 阶段切换开销 → 优化路由
- ❌ 上下文丢失 → 传递必要信息
- ❌ 调试困难 → 添加 pipeline 追踪

---

### Exp-30: 成本上限保护

**假设**: 设置成本上限可以防止意外超额

**变量**:
- `costLimit`: $10/天
- `alertThreshold`: 80%

**基线**: 无上限

**预期**:
```
Cost variance: -90%
Budget predictability: high
User control: improved
```

**实际**: ___

**结论**: ___

**失败路线**:
- ❌ 任务中断 → 添加 graceful degradation
- ❌ 误报告警 → 调整阈值
- ❌ 限制过严 → 动态调整

---

## 📈 持续优化机制

### 每周复盘模板

```markdown
## Week XX 复盘

**日期**: YYYY-MM-DD

### 关键指标
| 指标 | 上周 | 本周 | 变化 |
|------|------|------|------|
| 链路完成率 | XX% | XX% | ±X% |
| 平均成本 | $X | $X | ±X% |
| 用户满意度 | X.X | X.X | ±X.X |

### 实验进展
- 已完成: X/25
- 成功率: X%
- 关键发现: ...

### 下周计划
1. ...
2. ...
3. ...
```

---

## 🎓 学习记录

### Exp-XX: [实验名称]

**日期**: YYYY-MM-DD

**我为什么这么试**:
> [描述假设的来源和推理过程]

**预期会怎样**:
> [描述假设成立时的预期结果]

**实际结果如何**:
> [描述实际观察到的结果]

**关键洞察**:
> [从这次实验中学到了什么]

**如何应用到下次**:
> [具体的改进建议]

---

## 🔧 附录

### A. 成本计算公式

```
Total Cost = API_Cost + Compute_Cost + Storage_Cost

API_Cost = Σ(requests × model_rate_per_1k_tokens)
Compute_Cost = Σ(duration × compute_rate_per_second)
Storage_Cost = Σ(data_size × storage_rate_per_GB_month)
```

### B. 模型定价参考 (2026-07)

| 模型 | 输入 ($/1M) | 输出 ($/1M) |
|------|-------------|-------------|
| Haiku 4 | $0.80 | $0.80 |
| Sonnet 5 | $3.00 | $15.00 |
| Opus 4.8 | $15.00 | $75.00 |

### C. 成功标准

- 链路完成率 ≥ 90%
- Plan 审批率 ≥ 80%
- 成本降低 ≥ 50% (vs 基线)
- 用户满意度 ≥ 4.0/5.0
- 实验成功率 ≥ 70%

---

**最后更新**: 2026-07-06  
**维护者**: Opus (统筹优化)  
**状态**: 持续进行中
