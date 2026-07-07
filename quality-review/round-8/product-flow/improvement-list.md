# Round 8: Product Flow Review - improvement-list.md

## 高优先级 (立即修复)

1. **PF-001**: 实现验证触发逻辑
   - 文件: goal-loop-runner.ts:349
   - 操作: 实现 verifyStep() 方法，调用 runVerificationProfile
   - 验收: 验证流程自动化，无需人工介入

2. **PF-003**: 检查 automationBindingStore 初始化
   - 文件: bridge-api.ts
   - 操作: 在 createBridgeRuntime 中添加初始化
   - 验收: runtime 启动无错误

## 中优先级 (近期修复)

3. **PF-002**: 实现 lastResult 状态追踪
   - 文件: goal-loop-runner.ts:290
   - 操作: 在 tick() 中更新 lastResult 状态
   - 验收: getStatus() 返回正确的 lastResult

4. **PF-005**: 添加自动 cleanup 机制
   - 文件: chatgpt-web-source-adapter.ts
   - 操作: 添加定时 cleanup 或在 getMetrics 时清理
   - 验收: 长时间运行无内存泄漏

## 低优先级 (后续优化)

5. **PF-004**: 优化 health 状态更新
   - 文件: bridge-panel.tsx:1025
   - 操作: 在关键事件后立即触发更新
   - 验收: UI 状态同步延迟 < 1s

## 架构建议

- 考虑将验证逻辑从 goal-loop-runner.ts 提取到独立的验证模块
- 添加验证结果持久化，以便审计
- 实现验证超时和重试机制
