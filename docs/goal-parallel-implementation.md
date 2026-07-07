# Goal: 并行推进 cli-bridge 项目落地

> 本 Goal 指令用于自动化并行推进项目各模块落地，并通过多维度评审确保质量。

---

## 执行指令

### 🎯 立即执行以下任务（并行度: 5）

请同时执行以下 5 个并行任务，每个任务独立完成后记录结果：

---

### 任务 1: 完善 WorkBuddy Executor 健康检查

**文件**: `apps/local-server/src/execution/workbuddy-executor.ts`

**任务描述**:
WorkBuddy Executor 的健康检查逻辑需要完善。当前 `healthCheck()` 方法依赖 `getLastClaimedAt()`，但该方法可能未在 adapter 中实现。

**步骤**:
```
1. 读取 workbuddy-execution-adapter.ts，检查 getLastClaimedAt() 实现
2. 如果方法不存在或返回 0，创建默认实现（返回 Date.now() 表示活跃）
3. 在 executor 中添加启动时的健康检查日志
4. 添加测试验证健康检查正确返回 true/false
```

**验证条件**:
```bash
# 运行后，GET /bridge/executors 应返回 workbuddy healthy: true
```

---

### 任务 2: 实现 verifyStepOutput 验证逻辑

**文件**: `apps/local-server/src/goal/goal-automation-loop.ts`

**任务描述**:
当前 `verifyStepOutput()` 函数只是占位符，需要实现真正的验证逻辑。

**步骤**:
```
1. 分析 verifyStepOutput 函数（第 341-351 行）
2. 实现以下验证策略:
   - exitCode === 0 视为成功
   - stderr 有 "error" / "failed" / "panic" 关键词视为失败
   - 超时视为失败
   - 添加验证结果的结构化输出
3. 添加单元测试覆盖各种场景
```

**验证条件**:
```
1. 成功执行（exitCode=0）返回 {passed: true}
2. 失败执行（exitCode!=0）返回 {passed: false, reason: "exit code N"}
3. 有 error 关键词的 stderr 返回 {passed: false, reason: "error keyword found"}
```

---

### 任务 3: 编写 E2E 集成测试

**文件**: `tests/e2e/chatgpt-bridge-integration.test.ts`

**任务描述**:
当前项目只有一个 ADR 测试文件，需要补充端到端集成测试。

**步骤**:
```
1. 分析现有测试结构 (tests/e2e/adr-0036-verification.test.ts)
2. 创建 chatgpt-bridge-integration.test.ts，包含:
   - test('Goal 创建和 Plan 生成')
   - test('Gate 审批和执行分发')
   - test('Loop 启动和完成')
   - test('执行器状态查询')
3. 使用 mock 避免依赖真实 WorkBuddy
4. 确保测试可独立运行
```

**验证条件**:
```bash
npm test -- tests/e2e/chatgpt-bridge-integration.test.ts
# 预期: 所有测试通过
```

---

### 任务 4: 完善 Bridge Panel UI 状态展示

**文件**: `apps/extension/src/ui/bridge-panel.tsx`

**任务描述**:
Bridge Panel 当前状态展示不完整，需要完善。

**步骤**:
```
1. 读取当前 bridge-panel.tsx 和 state.ts
2. 添加以下状态展示:
   - Goal 列表（id, status, createdAt）
   - 活跃 Loop 进度
   - 执行器状态（workbuddy: 在线/离线）
   - Source Relay 连接状态
3. 添加 5 秒自动刷新
4. 添加错误状态展示
```

**验证条件**:
```
1. 打开 Bridge Panel 能看到所有活跃 Goal
2. 执行器离线时显示 ⚠️ 警告
3. Source Relay 断开时显示 🔴 状态
```

---

### 任务 5: 添加诊断端点

**文件**: `apps/local-server/src/routes/goal-loop-routes.ts`

**任务描述**:
需要添加更多诊断端点用于监控和问题排查。

**步骤**:
```
1. 在 goal-loop-routes.ts 添加:
   - GET /bridge/diagnostics/loops: 列出所有 Loop 详情
   - GET /bridge/diagnostics/store: 导出 Goal Store 快照
   - GET /bridge/diagnostics/metrics: 聚合指标
2. 添加诊断端点的权限检查（只允许 console-cookie）
3. 添加响应压缩
```

**验证条件**:
```bash
# 诊断端点返回正确格式的数据
GET /bridge/diagnostics/loops
GET /bridge/diagnostics/metrics
```

---

## 评审任务（并行执行）

完成上述 5 个任务后，执行以下评审任务：

---

### 评审 1: 代码质量评审

**使用工具**: `/code-review`

**评审范围**:
- 新增/修改的文件
- 关注：类型安全、错误处理、日志规范

**评审标准**:
```
✓ 无 any 类型（除非必要且有注释）
✓ 所有异步操作有 try-catch
✓ 关键操作有 console.log
✓ 命名符合项目约定
```

---

### 评审 2: 安全评审

**评审范围**:
- 所有新增的 HTTP 端点
- 权限检查是否完整
- 输入验证是否充分

**评审标准**:
```
✓ 敏感端点有认证
✓ 输入有长度限制
✓ 无硬编码 secrets
✓ 错误信息不泄露敏感信息
```

---

### 评审 3: 架构评审

**评审范围**:
- 新增模块与现有架构的一致性
- 依赖方向是否正确
- 接口设计是否合理

**评审标准**:
```
✓ 符合 ADR 设计决策
✓ 模块边界清晰
✓ 依赖单向（无循环依赖）
✓ 接口可扩展
```

---

## 执行记录模板

完成每个任务后，填写以下记录：

```
### 任务 N 执行记录

**开始时间**: YYYY-MM-DD HH:MM
**结束时间**: YYYY-MM-DD HH:MM
**执行人**: Claude

**执行结果**:
- [ ] 成功完成
- [ ] 部分完成，原因: ___
- [ ] 失败，原因: ___

**验证通过**:
- [ ] 是
- [ ] 否，原因: ___

**发现的问题**:
1. ___
2. ___

**后续行动**:
1. ___
```

---

## 最终验收

完成所有任务和评审后，确认以下条件：

### 核心验收（必须）
- [ ] 5 个任务全部完成
- [ ] 3 个评审全部通过
- [ ] 无 P0/P1 问题遗留

### 质量验收（建议）
- [ ] 测试覆盖率 ≥ 70%
- [ ] 代码符合项目规范
- [ ] 文档已更新

---

*本 Goal 指令通过 /goal 机制自动化执行*
*创建时间: 2026-07-06*
