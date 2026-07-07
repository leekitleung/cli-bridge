# CLI Bridge Documentation

CLI Bridge 是在 CLI 编码 Agent 和 ChatGPT Web 之间建立的安全、可验证的自动化上下文中继系统。

## 快速开始

1. **[快速开始指南](QUICKSTART.md)** - 5 分钟上手
2. **[错误码参考](error-codes.md)** - 常见问题排查

## 核心概念

- **Goal → Plan → Gate → Execute → Audit** - 目标驱动的自动化执行流程
- **Executor Registry** - 多执行器可插拔架构
- **Source Relay** - ChatGPT Web 状态同步

## 架构文档

- **[Goal 指令框架 v2](goal-instruction-framework-v2.md)** - 完整的 Goal 驱动执行规范
- **[Goal 指令框架](goal-instruction-framework.md)** - 基础概念

## 内部文档

> 以下文档面向开发者，包含实现细节和实验记录：

- `goal-directive.md` - Goal 指令格式
- `goal-experiment-tracker.md` - 实验追踪
- `goal-optimization-experiments.md` - 优化实验
- `goal-parallel-implementation.md` - 并行实现
- `goal-project-completion.md` - 项目完成标准
- `bridge-api-refactoring-plan.md` - API 重构计划
- `optimization-handover-2026-07-04.md` - 优化交接文档

## 技术栈

- **本地服务器**: Node.js + TypeScript
- **浏览器扩展**: TypeScript + WebExtensions API
- **执行器**: WorkBuddy、OpenCode、Claude Code

## 常见问题

### 无法连接到本地服务器
1. 确保 `npm start` 正在运行
2. 检查端口 31337 是否被占用
3. 查看控制台输出的 pairing token 是否正确

### Extension 无法获取状态
1. 在 ChatGPT 页面刷新
2. 点击 "Refresh Connection" 按钮
3. 检查浏览器扩展是否启用

### Goal 执行卡住
1. 检查 Gate 审批状态
2. 确认 WorkBuddy 服务可用
3. 查看 `/bridge/diagnostics/metrics` 端点
