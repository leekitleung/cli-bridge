# Goal: 完成 cli-bridge 项目落地与多维度验证

## 项目背景

cli-bridge 项目当前完成度约 65-70%，核心架构已完成，但端到端集成、测试覆盖、验证逻辑仍需完善。

## 执行目标

| 目标 ID | 目标 | 验收条件 |
|---------|------|----------|
| **O1** | 端到端链路完整可运行 | ChatGPT Web → Goal → Plan → Execute → Result 全流程跑通 |
| **O2** | E2E 测试覆盖 | 关键路径测试覆盖 ≥ 80% |
| **O3** | 验证逻辑完善 | verifyStepOutput() 等函数有完整实现 |
| **O4** | UI 可用性 | Bridge Panel 能展示完整链路状态 |

## 执行约束

- **最大循环次数**: 15 (多于默认的 10，预留缓冲)
- **执行超时**: 单步 5 分钟，整体 45 分钟
- **禁止的操作**:
  - 禁止修改 ADR 文档的设计决策
  - 禁止删除已通过评审的代码
  - 禁止绕过 Gate 审批直接执行
- **回退策略**: 测试失败立即回退到上一个稳定 commit

---

## Plan A: 核心链路完善 (并行任务组 A1-A4)

### A1: 执行器集成与健康检查

**目标**: WorkBuddy Executor 完整集成，健康检查正常工作

**步骤**:
```
1. 检查 workbuddy-executor.ts 与 workbuddy-execution-adapter.ts 的接口匹配
2. 修复 adapter.getLastClaimedAt() 等方法的实现
3. 添加 executor 的健康检查 HTTP 端点
4. 验证 /bridge/executors 返回正确状态
```

**验证**:
```bash
# 预期输出
GET /bridge/executors
{
  "total": 2,
  "healthy": 2,
  "executors": [
    {"id": "workbuddy", "name": "WorkBuddy", "healthy": true},
    {"id": "opencode", "name": "OpenCode", "healthy": false}
  ]
}
```

---

### A2: Goal Loop 自动执行流程

**目标**: Gate 审批后能自动触发执行，结果正确回传

**步骤**:
```
1. 检查 goal-loop-runner.ts 的 tick() 循环逻辑
2. 完善 gate-aware-execution.ts 的 executeApprovedGate()
3. 确保 execution result 能写入 goal store
4. 验证审批后任务自动分发到 WorkBuddy
```

**验证**:
```bash
# 预期流程
1. POST /bridge/goals/:id/loop/approve 成功
2. 查看 /bridge/goals/:id/loop/status 显示 step-completed
3. execution stats 显示 stepsCompleted +1
```

---

### A3: 验证逻辑实现

**目标**: verifyStepOutput() 有完整实现，非简单占位符

**步骤**:
```
1. 分析现有验证逻辑的缺陷（如果有）
2. 实现以下验证策略：
   - run-command: 检查 exitCode === 0
   - apply-patch: 检查 patch 应用成功
   - write-file: 检查文件存在且内容匹配
3. 添加验证失败的重试机制（最多 2 次）
4. 记录验证结果到 execution history
```

**验证**:
```
1. 模拟验证失败场景，确认返回 verification-fail
2. 模拟验证超时场景，确认有超时处理
3. 验证结果包含具体的失败原因
```

---

### A4: ChatGPT Web Source Relay 集成

**目标**: Source Relay 与 Goal 系统正确对接

**步骤**:
```
1. 检查 chatgpt-web-source-adapter.ts 的 plan() 方法
2. 确保 prompt 能正确路由到 GoalOrchestrator
3. 验证结果能回传到 Extension UI
4. 添加 Source Relay 状态诊断端点
```

**验证**:
```
1. Extension 发送 prompt → Bridge 收到
2. Bridge 创建 Goal → 状态正确
3. Goal 执行完成 → 结果回传 Extension
4. /bridge/relay/status 显示 connected
```

---

## Plan B: 测试覆盖完善 (并行任务组 B1-B3)

### B1: 单元测试补充

**目标**: 核心模块单元测试覆盖

**步骤**:
```
1. goal-orchestrator.test.ts:
   - 测试 step ceiling 边界
   - 测试 tier violation
   - 测试 fail-stop 行为
   - 测试 gate blocking

2. executor-registry.test.ts:
   - 测试执行器选择策略
   - 测试健康检查
   - 测试错误处理

3. execution-dispatcher.test.ts:
   - 测试任务分发
   - 测试 fallback 逻辑
```

**验证**:
```bash
npm test -- --coverage
# 预期: 覆盖率 ≥ 80%
```

---

### B2: 集成测试编写

**目标**: 关键路径端到端测试

**步骤**:
```
1. tests/e2e/chatgpt-bridge-integration.test.ts:
   - Source Relay → Bridge API → Goal 创建
   - Goal → Plan 生成
   - Plan 审批 → 执行分发

2. tests/e2e/goal-loop-integration.test.ts:
   - Loop 启动 → tick → 完成
   - Loop 失败处理
   - Loop 取消处理

3. tests/e2e/executor-routing.test.ts:
   - WorkBuddy 执行成功
   - Executor fallback
   - 超时处理
```

**验证**:
```
1. 所有测试通过
2. 测试隔离（无共享状态）
3. 测试能独立运行
```

---

### B3: 诊断端点验证

**目标**: 所有诊断端点返回正确信息

**步骤**:
```
1. POST /bridge/goals → 创建 Goal → 验证返回
2. GET /bridge/goals/:id → 验证状态正确
3. GET /bridge/loops → 验证列出活跃 Loop
4. GET /bridge/executors → 验证状态准确
5. GET /bridge/relay/status → 验证连接状态
```

**验证**:
```
所有端点返回 200，且响应格式与文档一致
```

---

## Plan C: UI 与用户体验 (并行任务组 C1-C2)

### C1: Bridge Panel 状态展示

**目标**: UI 正确展示链路状态

**步骤**:
```
1. 检查 bridge-panel.tsx 的状态映射
2. 实现以下状态展示:
   - Goal 列表及其状态
   - 活跃 Loop 的进度条
   - 执行器状态指示器
   - Source Relay 连接状态

3. 添加实时刷新（每 5 秒）
```

**验证**:
```
1. 打开 Bridge Panel 能看到所有活跃 Goal
2. Loop 进度实时更新
3. 执行器离线时显示警告
```

---

### C2: 错误处理与用户反馈

**目标**: 错误场景有清晰的用户反馈

**步骤**:
```
1. 统一错误格式:
   {
     "ok": false,
     "error": "描述",
     "code": "ERROR_CODE",
     "details": {...}
   }

2. Gate 审批超时的用户提示
3. 执行失败的上下文展示
4. 断线重连的 UI 反馈
```

**验证**:
```
1. 各种错误场景有对应提示
2. 提示信息用户友好
3. 错误可追溯（有 traceId）
```

---

## Plan D: 多维度评审 (任务组 D1-D5，并行执行)

### D1: 代码质量评审

**目标**: 代码符合项目规范

**评审维度**:
```
1. 类型安全: 无 any 类型滥用
2. 错误处理: 所有异步操作有 try-catch
3. 日志规范: 关键操作有 console.log
4. 代码重复: 提取公共函数
5. 命名规范: 符合项目约定
```

**评审方式**: 使用 /code-review skill 进行评审

---

### D2: 架构合理性评审

**目标**: 架构设计符合 ADR 决策

**评审维度**:
```
1. 模块边界清晰度
2. 依赖方向正确（单向依赖）
3. 接口设计合理性
4. 扩展性预留
5. 与现有 ADR 一致性
```

---

### D3: 安全与边界评审

**目标**: 无安全漏洞和边界问题

**评审维度**:
```
1. 认证/授权: 所有敏感端点有认证
2. 输入验证: prompt 等输入有长度限制
3. 资源限制: 无内存泄漏，无无限循环
4. 边界条件: 极端输入有处理
5. 敏感信息: 无硬编码 token/secrets
```

---

### D4: 性能评审

**目标**: 无性能瓶颈

**评审维度**:
```
1. 时间复杂度: O(n²) → O(n) 优化
2. 内存使用: 大数据量无 OOM 风险
3. 网络调用: 批量操作合并
4. 轮询间隔: 合理（不频繁不过慢）
5. 并发控制: 有 maxConcurrency 限制
```

---

### D5: 测试完整性评审

**目标**: 测试覆盖关键路径

**评审维度**:
```
1. 分支覆盖: if-else 分支都覆盖
2. 边界覆盖: 空数组、null、超长输入
3. 异常覆盖: 错误处理路径
4. 集成覆盖: 组件交互
5. E2E 覆盖: 关键用户路径
```

---

## Plan E: 文档同步 (并行任务组 E1-E2)

### E1: 文档更新

**目标**: 文档与实现一致

**步骤**:
```
1. 更新 goal-instruction-framework.md 的实现状态
2. 更新 goal-experiment-tracker.md 的检查清单
3. 添加 ADR-0036 验证框架文档
4. 更新 README.md 的快速开始指南
```

---

### E2: 示例与教程

**目标**: 有可运行的示例

**步骤**:
```
1. 添加 example-goal-basic.ts: 最简 Goal 使用
2. 添加 example-goal-complex.ts: 完整链路示例
3. 添加 tests/e2e/demo.test.ts: 演示脚本
```

---

## 执行计划

### 第一轮：核心链路 (并行度 4)
```
A1 ──┐
A2 ──┼──▶ Gate 审批自动执行 ──▶ D2 架构评审
A3 ──┤
A4 ──┘
```

### 第二轮：测试与验证 (并行度 3)
```
B1 ──┐
B2 ──┼──▶ D1 代码评审 ──▶ D3 安全评审
B3 ──┘
```

### 第三轮：UI 与完善 (并行度 2)
```
C1 ──┐
C2 ──┴──▶ D4 性能评审 + D5 测试评审
```

### 第四轮：文档与收尾
```
E1 ──▶ E2 ──▶ 最终评审
```

---

## 验收条件

### 必须通过
- [ ] 所有 E2E 测试通过
- [ ] 至少完成 3 次不同维度的评审
- [ ] 文档与实现一致
- [ ] 无 P0/P1 安全问题

### 建议完成
- [ ] 测试覆盖率 ≥ 80%
- [ ] 4-5 次评审覆盖所有维度
- [ ] 有可运行的示例代码

---

## 执行记录

### 第一轮执行记录

| Goal | Plan | 步骤 | 状态 | 日期 | 结果 | 问题 |
|------|------|------|------|------|------|------|
| - | - | - | - | - | - | - |

### 评审记录

| 评审 | 维度 | 评审人 | 日期 | 发现问题 | 状态 |
|------|------|--------|------|----------|------|
| - | - | - | - | - | - |

---

*创建时间: 2026-07-06*
*版本: v1.0*
