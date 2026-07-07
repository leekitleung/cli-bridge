# Round 8: Product Flow Review - blockers.md

## P0 Blockers (Must Fix)
None

## P1 Blockers (Should Fix)

### PF-001: 验证触发未实现
- **Severity:** P1
- **File:** `apps/local-server/src/goal/goal-loop-runner.ts`
- **Line:** 349
- **Issue:** autoVerify 选项存在但验证触发是 TODO
- **Impact:** Gate 审批后的自动验证流程不完整
- **Fix:** 实现 verifyStep() 方法，调用 runVerificationProfile

### PF-003: automationBindingStore 未初始化
- **Severity:** P1
- **File:** `apps/local-server/src/routes/bridge-api.ts`
- **Line:** 1586
- **Issue:** automationBindingStore 在 runtime 中使用但未初始化
- **Impact:** 可能在使用时未定义导致错误
- **Fix:** 添加 automationBindingStore: InMemoryAutomationBindingStore 初始化

## P2 Blockers (Consider Fixing)

### PF-002: lastResult 始终为 null
- **Severity:** P2
- **File:** `apps/local-server/src/goal/goal-loop-runner.ts`
- **Line:** 290
- **Impact:** 调用者无法获取最后执行结果

### PF-004: health 状态更新滞后
- **Severity:** P2
- **File:** `apps/extension/src/ui/bridge-panel.tsx`
- **Line:** 1025
- **Impact:** UI 显示可能不是最新的

### PF-005: cleanup() 未自动调用
- **Severity:** P2
- **File:** `apps/local-server/src/conversation/chatgpt-web-source-adapter.ts`
- **Line:** 234-242
- **Impact:** 长时间运行后可能积累过期请求
