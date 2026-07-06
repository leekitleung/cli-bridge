# CLI-Bridge 项目优化建议交接文档

> 生成日期: 2026-07-04
> 项目路径: `/Users/namkit/Documents/1.Projects/cli-bridge`

---

## 一、已修复的问题

本次会话已修复以下 ESLint/TypeScript 错误：

| 问题 | 文件 | 修复方式 |
|------|------|----------|
| 缺失 import `InMemoryConversationExecutionStore` | `bridge-api.ts` | 添加 import |
| 缺失 import `InMemoryConversationRouteStore` | `bridge-api.ts` | 添加 import |
| 缺失 import `InMemoryPlanProposalStore` | `bridge-api.ts` | 添加 import |
| 缺失 import `PlannerAdapterRegistry` 等 | `bridge-api.ts` | 添加 14 个 import |
| 类型断言 `unknown` → `string` | `bridge-api.ts:1249` | 添加 `as string` |
| 使用未定义变量 `isTestEnvironment` | `origin-guard.ts:63` | 改为 `_isTestEnvironment` |
| 缺失类型 `AutomationLoopRun/Cycle` | `json-snapshot-store.ts` | 添加 type import |
| ESLint `no-useless-assignment` | 多个文件 | 重构变量作用域 |
| ESLint `no-empty` | 19 处 | 添加 `/* skip bad record */` 注释 |
| ESLint `no-control-regex` | 2 处 | 添加 eslint-disable 注释 |

**当前状态**: TypeScript 编译通过，ESLint 0 errors / 18 warnings（均为 intentional `no-explicit-any`）

---

## 二、性能优化建议

### P1: 自动化循环运行器中的冗余查找 [低优先级]

**文件**: `apps/local-server/src/automation/automation-loop-runner.ts`

**问题**: `tickAutomationLoop` 函数在每次 store 变更后都调用 `runtime.automationLoopStore.get(loopId)!` 重新获取循环实例。全函数有 15+ 处类似调用。

```typescript
// 当前模式
runtime.automationLoopStore.start(loopId, ...);  // line 72
const loop = runtime.automationLoopStore.get(loopId)!;  // 冗余查找
```

**建议**: 在变更后通过局部变量传递更新后的循环对象，避免重复 Map 查找。

---

### P2: 连接断开后未清理定时器 [低优先级]

**文件**: `apps/local-server/src/routes/project-console.ts:1049-1057`

**问题**: 两组 `setInterval` 在连接断开后仍持续运行，造成不必要的 CPU 消耗。

```typescript
window.setInterval(pollConversationMessages, 3000);  // 断开后仍在执行
window.setInterval(() => { ... }, 1000);
```

**建议**: 在连接断开时调用 `clearInterval`，或在 `pollConversationMessages` 中添加更早的 return 检查。

---

### P3: 重复的 Hydration 错误处理模式 [低优先级]

**文件**: `apps/local-server/src/routes/bridge-api.ts:1643-1717`

**问题**: 60+ 行几乎相同的 `try { hydrate... } catch { /* skip */ }` 代码块。

**建议**: 抽取为通用辅助函数：

```typescript
function hydrateOrSkip<T>(
  items: T[] | undefined,
  hydrate: (item: T) => void,
  getId: (item: T) => string,
): string[] {
  const skipped: string[] = [];
  for (const item of items ?? []) {
    try { hydrate(item); }
    catch { skipped.push(getId(item)); }
  }
  return skipped;
}
```

---

## 三、安全优化建议

### S1: E2E 脚本中的动态代码生成 [中优先级]

**文件**: `scripts/web-auto-release-e2e.ts:326`

```typescript
const dynamicImport = new Function('specifier', 'return import(specifier)') as ...
```

**建议**: 改用标准动态 import：

```typescript
const dynamicImport = (specifier: string) => import(specifier);
```

---

### S2: JSON.parse 缺少异常处理 [中优先级]

**文件**: `apps/local-server/src/routes/bridge-api.ts:2212`

**问题**: `readJsonBody` 函数直接调用 `JSON.parse(text)` 无 try-catch。

```typescript
const parsed = JSON.parse(text);  // 缺少异常处理
```

**建议**: 包装为 try-catch，返回结构化错误响应：

```typescript
let parsed: unknown;
try {
  parsed = JSON.parse(text);
} catch {
  return { ok: false, message: 'Invalid JSON body' };
}
```

---

### S3: innerHTML 使用缺乏 CSP [中优先级]

**文件**:
- `apps/local-server/src/routes/project-console.ts` (80+ 处)
- `apps/extension/src/popup/index.ts` (6 处)

**问题**: 使用 `escapeHtml()` 后设置 `innerHTML`，但无 Content-Security-Policy 头保护。

**建议**:
1. 审查 `escapeHtml` 函数确保覆盖所有 XSS 向量（属性注入、SVG/MathML 注入）
2. 考虑添加严格 CSP 响应头

---

## 四、架构优化建议

### A1: bridge-api.ts 文件过大 [中优先级]

**文件**: `apps/local-server/src/routes/bridge-api.ts` (~230KB, 4000+ 行)

**问题**: 单文件包含路由处理器、运行时创建、快照恢复、辅助函数等，职责不清。

**建议**: 拆分为模块化结构：

```
src/routes/
├── bridge-api.ts          # 主入口（路由注册、依赖注入）
├── handlers/              # 各端点处理器
│   ├── goals-handler.ts
│   ├── projects-handler.ts
│   ├── conversation-handler.ts
│   └── ...
├── runtime/
│   ├── runtime-builder.ts # Runtime 创建
│   └── hydrators.ts       # 快照恢复逻辑
└── middleware/
    └── auth.ts            # 认证中间件
```

---

### A2: 非空断言模式风险 [中优先级]

**文件**: 多处 store 文件

```typescript
// team-store.ts:148
this.artifacts.get(teamId)!.push(clone(artifact));

// goal-binding-snapshot-store.ts:137
this.snapshots.get(snapshot.goalId)!.push(clone(snapshot));
```

**问题**: `!` 断言假设 map 必含 key，但懒初始化场景下可能抛运行时异常。

**建议**: 使用可选链 + 回退：

```typescript
if (!this.artifacts.has(teamId)) {
  this.artifacts.set(teamId, []);
}
this.artifacts.get(teamId)!.push(clone(artifact));
```

---

## 五、类型安全优化建议

### T1: `as any` 类型断言泛滥 [中优先级]

**文件**: `apps/local-server/src/routes/bridge-api.ts`

```typescript
const recorded = runtime.teamStore.recordArtifact(teamId, artifact as any);  // line 898
const task = runtime.workbuddyStore.recordTaskReference(payload as any);     // line 1257
```

**问题**: `as any` 完全绕过类型检查，运行时可能传入非法数据。

**建议**: 在使用前通过 schema 断言函数验证：

```typescript
import { assertWorkBuddyPayload } from '../../../../packages/shared/src/schemas.ts';

const payload = artifact as unknown;
assertWorkBuddyPayload(payload);  // 验证失败抛异常
const task = runtime.workbuddyStore.recordTaskReference(payload);
```

---

### T2: JSON 快照反序列化类型丢失 [中优先级]

**文件**: `apps/local-server/src/storage/json-snapshot-store.ts:162`

```typescript
(parsed.conversationTranscriptEvents as any[]).map((e: any) => ({...}))
```

**问题**: `as any[]` 和 `(e: any)` 完全绕过类型检查。

**建议**: 定义 `ConversationTranscriptEvent` 类型并使用断言函数验证。

---

## 六、错误处理优化建议

### E1: 空 catch 块静默吞错 [低优先级]

**文件**: 多个文件

```typescript
// contained-process.ts:70
try { child.kill(...); } catch { /* already closed */ }

// project-console.ts:827
try { data = await res.json(); } catch {}
```

**建议**: 添加说明注释或最小化日志：

```typescript
try { child.kill(...); }
catch {
  // Process already terminated — no action needed
}
```

---

### E2: 轮询器 Promise rejection 静默丢失 [低优先级]

**文件**:
- `apps/extension/src/content/source-relay-poller.ts:188`
- `apps/extension/src/content/outbound-poller.ts:237`

```typescript
tick().catch(() => options.onEvent?.({ type: 'failed', reason: 'poller-error' }));
```

**问题**: `options.onEvent` 为 undefined 时错误完全静默消失。

**建议**: 增加错误日志：

```typescript
tick().catch((err) => {
  console.error('[SourceRelayPoller] tick failed:', err);
  options.onEvent?.({ type: 'failed', reason: 'poller-error' });
});
```

---

## 七、测试覆盖建议

### 高优先级待测区域

| 区域 | 文件 | 风险等级 | 说明 |
|------|------|----------|------|
| Goal Plan Parser | `goal-plan-parser.ts` | 高 | 复杂解析逻辑，多边界情况 |
| Workspace Apply Store | `workspace-apply-store.ts` | 高 | 文件系统操作，涉安全 |
| 安全/脱敏模块 | `redaction.ts`, `origin-guard.ts` | 高 | 安全关键代码 |
| JSON 快照存储 | `json-snapshot-store.ts` | 高 | 数据持久化与恢复 |
| 自动化循环运行器 | `automation-loop-runner.ts` | 高 | 核心编排逻辑 |
| 存储 Store | `storage/` 下 30+ 文件 | 中 | 内存状态管理 |
| 路由注册 | `conversation-route-registry.ts` | 中 | 正则路由逻辑 |

**当前状态**: 未发现 `*.test.ts` 或 `*.spec.ts` 单元测试文件，仅有 `scripts/` 下的集成测试。

---

## 八、总结

| 类别 | 问题数 | 优先级 |
|------|--------|--------|
| 性能 | 3 | 低 |
| 安全 | 3 | 中 |
| 架构 | 2 | 中 |
| 类型安全 | 2 | 中 |
| 错误处理 | 2 | 低 |
| 测试覆盖 | 6+ 区域 | 高 |

**建议优先级排序**:
1. **立即**: 修复 S2 (JSON.parse 异常处理) — 可能导致未捕获异常
2. **本周**: 修复 T1/T2 (类型断言问题) — 运行时风险
3. **本月**: 添加测试覆盖 (E1 高风险区域)
4. **规划中**: 重构 A1 (bridge-api.ts 拆分) — 长期维护成本高
