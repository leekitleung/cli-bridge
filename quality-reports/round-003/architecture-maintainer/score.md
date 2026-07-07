# Architecture Maintainer Review - Score Details
## Round: 003 | Date: 2026-07-07

## Overall Score: 73/100 (及格 - 必须改进)

---

## Dimension Breakdown

| Dimension | Score | Evidence |
|-----------|-------|----------|
| 模块职责清晰度 | 17/25 | bridge-api.ts (5331行) 是严重的上帝文件；goal-automation-loop.ts (550行) 混合多种职责 |
| 可维护性 | 18/25 | execution 模块重复；缺少 barrel exports；路由处理分散 |
| 状态管理 | 13/20 | BridgeRuntime 集中管理较好；存储类使用私有 Map；存在潜在的竞态条件风险 |
| 错误处理架构 | 12/15 | BridgeResult 统一类型；缺少自定义错误体系；降级策略部分实现 |
| 可测试性 | 13/15 | ExecutionDispatcher 支持 DI；存储类易于 mock；缺少完整测试覆盖 |

---

## Specific Issues

### P1 (Critical): bridge-api.ts 是上帝文件
- **文件**: `apps/local-server/src/routes/bridge-api.ts`
- **行数**: 5331 行
- **问题**: 
  - 包含 70+ 路由处理函数（GET/POST/PUT/DELETE）
  - 混合了 HTTP 路由、存储初始化、运行时创建等职责
  - 超过 2000 行阈值 2.6 倍
- **证据**:
  - `handleBridgeRequest` 函数 (2441行开始) 包含所有路由路由
  - `createBridgeRuntime` 函数 (1549行开始) 包含 40+ 存储初始化
  - 路由路径常量定义在单独文件 `bridge/paths.ts`
- **建议**: 
  1. 将路由处理器按功能域拆分到独立文件
  2. 创建 `routes/goals.ts`, `routes/projects.ts`, `routes/teams.ts` 等
  3. 将运行时创建逻辑移到 `runtime/` 目录

### P2 (Critical): goal-automation-loop.ts 违反 SRP
- **文件**: `apps/local-server/src/goal/goal-automation-loop.ts`
- **问题**: 
  - `tickGoalLoop` 函数 (148-270行) 超过 120 行
  - 包含状态获取、orchestrator 调用、结果处理、验证等混合职责
  - `verifyStepOutput` 函数包含复杂的误报检测逻辑
- **证据**:
  ```typescript
  // tickGoalLoop 包含 5 种不同类型的结果处理分支
  switch (advanceResult.type) {
    case 'noop': ...
    case 'plan-completed': ...
    case 'step-failed': ...
    case 'step-gated': ...
    case 'step-completed': ...
    // ...
  }
  ```
- **建议**: 拆分 tickGoalLoop 为多个专用处理函数

### P3 (Warning): execution 模块重复
- **文件**: 
  - `apps/local-server/src/execution/execution-dispatcher.ts`
  - `apps/local-server/src/execution/execution-dispatcher-v2.ts`
- **问题**: 两个文件功能重叠，职责不清
- **建议**: 合并或明确区分两个文件职责

### P4 (Warning): 缺少 barrel exports
- **问题**: `execution/` 和 `goal/` 目录有 `index.ts` 但其他目录缺失
- **建议**: 为所有主要模块添加 `index.ts` 统一导出

---

## Red Lines (红线规则)

| 规则 | 状态 | 说明 |
|------|------|------|
| 循环依赖 | ✅ 通过 | 未检测到循环依赖 |
| 全局可变状态 | ⚠️ 警告 | BridgeRuntime 使用私有 Map 管理状态，可接受 |
| 同步副作用 | ✅ 通过 | 无在关键路径的同步副作用 |
| 模块边界穿越 | ✅ 通过 | storage 不直接调用 routes |

---

## Recommendations (改进建议)

### 立即行动 (P0)
1. **拆分 bridge-api.ts**
   - 创建 `routes/handlers/` 目录
   - 拆分: `goals-handler.ts`, `projects-handler.ts`, `teams-handler.ts`, `apply-handler.ts`, `workbuddy-handler.ts`
   - 创建 `runtime/bridge-runtime.ts` 分离运行时创建逻辑

2. **重构 goal-automation-loop.ts**
   - 将 `tickGoalLoop` 拆分为:
     - `getGoalLoopContext()` - 获取 Goal/Plan 上下文
     - `advanceGoalOrchestrator()` - 调用 orchestrator
     - `handleAdvanceResult()` - 统一结果处理
     - `verifyStep()` - 独立验证逻辑

### 高优先级 (P1)
3. **解决 execution 模块重复**
   - 评估 `execution-dispatcher-v2.ts` 是否为实验性代码
   - 如需保留，明确 v2 的差异化职责
   - 否则合并到 v1

4. **添加 barrel exports**
   - 为 `storage/`, `routes/`, `adapters/` 添加 index.ts

### 中优先级 (P2)
5. **增强测试覆盖**
   - 为拆分后的路由处理器添加单元测试
   - 为 storage 类添加边界条件测试

---

## Evidence Summary

### 文件大小统计
```
5331 lines: bridge-api.ts (CRITICAL - 超过阈值 2.6 倍)
  550 lines: goal-automation-loop.ts
  418 lines: chatgpt-web-source-adapter.ts
  414 lines: automation-loop-store.ts
  331 lines: command-runner.ts
  303 lines: workbuddy-execution-adapter.ts
```

### 目录结构
```
src/
  goal/          ✅ 有 index.ts，职责相对清晰
  execution/     ⚠️ 有 index.ts，但存在重复文件
  storage/       ❌ 无 index.ts，缺少统一导出
  routes/        ❌ 无 index.ts，bridge-api.ts 是上帝文件
```

### 依赖关系
```
routes/bridge-api.ts
  ├── imports: storage/* (goal-store, team-store, etc.)
  ├── imports: execution/* (dispatcher)
  ├── imports: conversation/*
  └── imports: adapters/*
  
goal/goal-automation-loop.ts
  └── imports: BridgeRuntime, GoalOrchestrator
  
execution/execution-dispatcher-v2.ts
  └── imports: executor-registry
```

---

## Verdict

**状态**: FAIL (不及格 - 需要重构)

**分数**: 73/100

**核心问题**: bridge-api.ts 作为 5331 行的上帝文件是架构腐化的明确信号。虽然新添加的 goal/ 和 execution/ 模块有良好的设计意图（index.ts、依赖注入），但核心 API 层仍然是单点故障。

**建议**: 必须进行架构重构后才能发布。优先拆分 bridge-api.ts，并解决 execution 模块重复问题。
