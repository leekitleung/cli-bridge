# bridge-api.ts 提取计划

## 目标
将 5493 行的 god file 提取为多个模块，目标每模块 < 500 行。

## 当前结构

```
bridge-api.ts (5493 lines)
├── 类型定义 (1-350)
│   ├── BridgeAuthKind, BridgeAuthContext
│   ├── BridgeRuntime interface
│   └── BridgeRuntimeOptions interface
├── Team/Apply handlers (408-1100)
│   ├── matchProjectTeamPath()
│   ├── matchTeamApplyPath()
│   ├── handleApplyRequestCreate/Confirm/Discard
│   ├── handleTeamsPost
│   └── handleSlotAdvancePost
├── WorkBuddy handlers (1106-1300)
│   ├── matchProjectWorkBuddyPath()
│   ├── isLocalWorkBuddyFastRequest()
│   ├── sanitizeWorkBuddyPayload()
│   └── postWorkBuddyMultiplex()
├── Verification (1450-1547)
│   └── handleVerificationProfilesGet/ConfirmPost
├── Runtime 初始化 (1547-1900)
│   ├── createBridgeRuntime()
│   └── scheduleChatGptWebSourceTimeout()
├── 响应格式化 (1900-2100)
│   ├── ok(), created(), error()
│   └── formatWorkBuddyConversationResult()
├── 项目视图构建 (2000-2250)
│   ├── buildProjectSummaries()
│   ├── buildProjectDetail()
│   └── buildObservabilityInput()
├── 主路由分发 (2600-5493)
│   └── handleBridgeRequest()
└── 路径辅助 (2513-2600)
    ├── isBridgePath()
    └── validateRebindEndpoints()
```

## 提取计划

### Phase 1: 提取验证和响应工具 (无依赖)

**目标模块:**
- `validators/apply-validators.ts` - Apply request 验证
- `validators/workbuddy-validators.ts` - WorkBuddy payload 验证
- `validators/rebind-validators.ts` - Endpoint rebind 验证
- `response/builders.ts` - ok/created/error helpers
- `response/formatters.ts` - Conversation result formatters

### Phase 2: 提取项目视图构建器 (轻量依赖)

**目标模块:**
- `views/project-summaries.ts` - buildProjectSummaries()
- `views/project-detail.ts` - buildProjectDetail()
- `views/observability.ts` - buildObservabilityInput()
- `views/workbuddy-views.ts` - WorkBuddy view builders

### Phase 3: 提取 Team/Apply handlers

**目标模块:**
- `handlers/apply-handlers.ts` - Apply request handlers
- `handlers/team-handlers.ts` - Team operation handlers
- `handlers/slot-handlers.ts` - Slot advancement handlers

### Phase 4: 提取 WorkBuddy 处理器

**目标模块:**
- `handlers/workbuddy-handlers.ts` - WorkBuddy 请求路由
- `handlers/verification-handlers.ts` - Verification handlers

### Phase 5: 提取主路由分发

**目标模块:**
- `router/bridge-router.ts` - handleBridgeRequest 主函数
- `router/path-matchers.ts` - Path matching utilities
- `router/extract-handlers.ts` - Extraction return handlers

### Phase 6: 清理和整合

- 删除已提取的代码
- 更新 import 语句
- 验证类型检查通过
- 验证测试通过

## 风险缓解

1. **保持功能不变**: 每步提取后运行测试
2. **增量提交**: 每个 phase 单独提交
3. **保留历史**: 不删除原代码直到新模块验证通过

## 验收标准

1. `bridge-api.ts` < 1000 行
2. 所有测试通过
3. 类型检查通过
4. 无运行时错误
