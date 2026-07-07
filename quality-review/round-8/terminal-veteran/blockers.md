# Round 8: Terminal Veteran Review - blockers.md

## P1 Blockers (Should Fix)

### TV-R8-001: cmd.exe allowlist bypass (部分修复)
- **Severity:** P1
- **File:** `apps/local-server/src/workbuddy/command-backend.ts`
- **Lines:** 51-66, 198-211
- **Issue:** 已添加 WINDOWS_SAFE_BUILTINS 白名单，但仍需验证
- **Status:** 部分修复，待验证
- **Fix:** 确保 validateWindowsCmdArgs 正确工作

### TV-R8-002: 输出截断逻辑 bug
- **Severity:** P1
- **File:** `apps/local-server/src/workbuddy/command-backend.ts`
- **Lines:** 272-297
- **Issue:** 仅截断 stdout，stderr 可能超过 cap
- **Fix:** 确保 stdout + stderr 总长度 <= outputCapBytes

### TV-R8-003: 错误上下文丢失
- **Severity:** P1
- **File:** `apps/local-server/src/workbuddy/command-backend.ts`
- **Line:** 349
- **Issue:** stderr: err.message 丢失堆栈信息
- **Fix:** 添加 err.code, err.stack 等上下文

## P2 Blockers (Consider Fixing)

### TV-R8-004: 缺少结构化日志
- **Severity:** P2
- **Issue:** 无命令执行审计日志
- **Fix:** 添加 console.debug 级别的执行记录

### TV-R8-005: 超时处理竞态条件
- **Severity:** P2
- **Lines:** 260-267
- **Issue:** 进程在精确超时时刻退出可能导致状态不一致
