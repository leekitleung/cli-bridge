# Round 8: Destructive QA Review - blockers.md

## CRITICAL Issues (0)
None

## HIGH Issues (0)
H-1 和 H-2 已在代码中修复，但需要验证。

### H-1: cmd.exe allowlist bypass (FIXED)
- **Status:** 已添加 WINDOWS_SAFE_BUILTINS 白名单验证
- **Files:** command-backend.ts:55-59, 80-104, 198-211
- **Verification Needed:** 测试 validateWindowsCmdArgs 函数

### H-2: Working directory path traversal (FIXED)
- **Status:** 已添加 sandbox boundary 检查
- **File:** command-backend.ts:215-225
- **Verification Needed:** 测试 path traversal 被阻止

## MEDIUM Issues (Should Fix)

### M-1: Insufficient rate limiter per-IP tracking
- **Severity:** MEDIUM
- **File:** `apps/local-server/src/security/rate-limiter.ts`
- **Issue:** 无全局请求计数器，旋转代理可绕过限制
- **Fix:** 实现滑动窗口限速

### M-2: Token comparison timing attack
- **Severity:** MEDIUM
- **File:** `apps/local-server/src/security/pairing.ts`
- **Issue:** 长度比较泄露 token 长度
- **Fix:** 使用 timingSafeEqual 前进行固定长度哈希比较

### M-3: Session claim nonce reuse not atomic
- **Severity:** MEDIUM
- **File:** `apps/local-server/src/security/local-auto-pair-session.ts`
- **Issue:** 检查-then-设置非原子操作
- **Fix:** 使用 compare-and-swap 或 mutex

## LOW Issues (Consider Fixing)

- L-1: Origin guard accepts null origin
- L-2: Sensitive content redaction regex limitations
- L-3: Output truncation may leave partial data
- L-4: No process zombie cleanup on error path
