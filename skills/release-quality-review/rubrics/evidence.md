# 证据收集指南 (Evidence Collection Guide)

证据是评分的基础。没有证据的评分是不可接受的。

## 证据类型

### 1. 代码证据

**来源**: 代码文件本身

**用途**: 证明功能存在、状态处理、错误处理等

**收集方式**:
```bash
# 查找关键代码
grep -n "async\|await\|then\|catch" --include="*.ts" | head -50

# 查找错误处理
grep -rn "throw\|Error\|reject" --include="*.ts" | head -30

# 查找状态处理
grep -rn "if.*null\|if.*undefined\|if.*empty" --include="*.ts" | head -20
```

### 2. 运行证据

**来源**: 实际运行程序

**用途**: 证明功能可用、路径正确、错误处理有效

**收集方式**:
```bash
# 构建验证
pnpm build 2>&1

# 测试运行
pnpm test 2>&1

# 类型检查
pnpm typecheck 2>&1

# Lint 检查
pnpm lint 2>&1
```

### 3. 截图证据

**来源**: UI 截图

**用途**: 证明视觉效果、交互状态、错误展示

**要求**:
- 标注截图对应的功能
- 包含正常和异常状态
- 清晰可读

### 4. 日志证据

**来源**: 程序输出日志

**用途**: 证明错误处理、请求流程、状态变化

**收集方式**:
```bash
# 服务器日志
tail -f logs/server.log

# 浏览器控制台
# (使用开发者工具导出)
```

### 5. Git 证据

**来源**: Git 历史

**用途**: 证明变更历史、代码演进

**收集方式**:
```bash
# 变更统计
git diff --stat

# 特定文件的变更
git log -p --follow -- "file.ts"

# 最近的提交
git log --oneline -10
```

## 必须收集的证据

### 产品闭环审查官

| 证据 | 来源 | 何时需要 |
|------|------|----------|
| 构建成功 | `pnpm build` | 每次评审 |
| API 路由可用 | curl 或代码检查 | 每次评审 |
| UI 组件渲染 | 截图或代码检查 | 有 UI 变更时 |
| 错误处理 | 代码检查 | 每次评审 |

### 工程架构审查官

| 证据 | 来源 | 何时需要 |
|------|------|----------|
| 模块边界 | 代码结构 | 每次评审 |
| 类型定义 | 代码检查 | 每次评审 |
| 依赖关系 | 代码检查或工具 | 架构变更时 |
| 循环依赖 | 工具检测 | 每次评审 |

### 验收发布审查官

| 证据 | 来源 | 何时需要 |
|------|------|----------|
| 测试通过 | `pnpm test` | 每次评审 |
| 构建成功 | `pnpm build` | 每次评审 |
| 类型检查通过 | `pnpm typecheck` | 每次评审 |
| E2E 测试通过 | `pnpm test:e2e` | 发布前 |
| 包发布成功 | npm/yarn 输出 | 发布时 |

### 破坏性质量官

| 证据 | 来源 | 何时需要 |
|------|------|----------|
| 安全扫描 | `npm audit` 或工具 | 每次评审 |
| 敏感数据处理 | 代码检查 | 有数据变更时 |
| 权限检查 | 代码检查 | 有权限变更时 |
| 输入验证 | 代码检查 | 有用户输入时 |

## 证据记录格式

每个 reviewer 应该在 `evidence.md` 文件中记录证据：

```markdown
# Evidence - [Reviewer Name]

## Build Evidence
```
[pnpm build output]
```

## Test Evidence
```
[pnpm test output]
```

## Code Evidence

### Error Handling
- `apps/local-server/src/routes/bridge-api.ts:123` - 有 try-catch
- `apps/local-server/src/storage/goal-store.ts:45` - 有错误边界

## Screenshots
![](./screenshots/feature-x.png)
```

## 证据质量标准

### 有效证据
- ✅ 直接引用代码行号
- ✅ 实际运行命令的输出
- ✅ 带标注的截图
- ✅ 具体的错误信息

### 无效证据
- ❌ "代码看起来没问题"
- ❌ "应该可以工作"
- ❌ "根据经验判断"
- ❌ 截图无标注

## 自动证据收集

review-gate.mjs 支持自动收集证据：

```bash
# 启用自动证据收集 (默认)
node review-gate.mjs --collect-evidence

# 跳过证据收集
node review-gate.mjs --no-collect
```

自动收集的证据包括:
- Git 状态和变更
- Package.json 信息
- 项目结构
- 构建输出 (如果构建已运行)

## 证据与评分的关系

| 证据类型 | 对评分的影响 |
|----------|--------------|
| 有证据 + 通过 | 不扣分 |
| 有证据 + 未通过 | 正常扣分 |
| 无证据 + 通过 | 最多给 80 分 |
| 无证据 + 未通过 | 必须提供证据 |

## 常见证据缺失

| 场景 | 应该收集的证据 |
|------|----------------|
| 声称功能完整 | 实际运行截图或日志 |
| 声称错误处理完善 | 触发错误的日志 |
| 声称测试覆盖 | 测试输出 + 覆盖率报告 |
| 声称构建成功 | 构建输出 |
| 声称 UI 正常 | 截图 |
