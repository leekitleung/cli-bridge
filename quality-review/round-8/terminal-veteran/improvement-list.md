# Round 8: Terminal Veteran Review - improvement-list.md

## P1 立即修复

1. **TV-R8-002**: 修复输出截断逻辑
   - 文件: command-backend.ts:272-297
   - 操作: 确保 stdout + stderr 总长度 <= outputCapBytes
   - 验收: 单元测试验证截断行为

2. **TV-R8-003**: 增强错误消息上下文
   - 操作: stderr: `${err.message} (code: ${err.code})`
   - 验收: 错误消息包含足够的调试信息

## P2 近期修复

3. **TV-R8-004**: 添加结构化日志
   - 操作: 添加 console.debug 级别的命令执行记录
   - 验收: 可以追踪命令执行历史

4. **TV-R8-005**: 修复超时竞态条件
   - 操作: 在 close 回调中检查 timedOut 标志
   - 验收: 边界情况测试通过

## P3 后续优化

5. 添加命令执行审计日志持久化
6. 实现请求 ID 追踪
7. 添加分布式追踪支持
