# CLI Bridge 快速开始

## 一句话介绍

CLI Bridge 是一个**安全的、可验证的、受控自动化上下文中继**，连接 CLI 编码代理 (Codex/WorkBuddy) 和 ChatGPT Web。

## 系统架构

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           CLI Bridge 架构                                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌──────────────┐    HTTP (127.0.0.1)    ┌─────────────────────────┐ │
│  │  CLI Agent   │◄────────────────────────►│   Local Server        │ │
│  │ (WorkBuddy/  │    /bridge/* (认证)     │   (端口 31337)        │ │
│  │  Codex)      │                          │                       │ │
│  └──────────────┘                          └───────────┬─────────────┘ │
│                                                        │              │
│                              ┌─────────────────────────┼─────────────┐ │
│                              │                         │             │ │
│                              ▼                         ▼             ▼ │
│                     ┌────────────────┐         ┌────────────┐  ┌──────────┐
│                     │  Goal/Plan     │         │  Bridge    │  │  Source  │
│                     │  Loop Runner   │         │  API      │  │  Relay   │
│                     └────────────────┘         └────────────┘  └──────────┘
│                                                         │
└─────────────────────────────────────────────────────────┼───────────────┘
                                                          │
                          ┌────────────────────────────────┼────────────────┐
                          │                                │                │
                          ▼                                ▼                ▼
                   ┌──────────────┐              ┌───────────────┐ ┌──────────────┐
                   │  Project     │              │  Browser      │ │  Console     │
                   │  Console     │              │  Extension    │ │  UI          │
                   │  (Web UI)    │              │  (Bridge      │ │  (Web UI)    │
                   │              │              │  Panel)       │ │              │
                   └──────────────┘              └───────────────┘ └──────────────┘
```

## 3 步快速开始

### 第 1 步：安装

```bash
npm install
```

### 第 2 步：启动服务

```bash
# 标准启动
npm start

# 或带配置启动
npm run start:local-configured
```

服务启动后会显示：
```
CLI Bridge local server listening on http://127.0.0.1:31337
Console UI: http://127.0.0.1:31337/console
Pairing token: xxxxxxxx****
```

### 第 3 步：加载浏览器扩展

1. 打开 Chrome，进入 `chrome://extensions/`
2. 开启「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择 `apps/extension/dist` 目录
5. 打开 ChatGPT Web 页面，Bridge Panel 应出现在右下角

## 验证安装

```bash
# 检查服务健康
curl http://127.0.0.1:31337/health

# 检查诊断指标
curl http://127.0.0.1:31337/bridge/diagnostics/metrics
```

## 常见问题

### Q: 扩展无法连接？

检查配对状态：
```bash
curl -H "X-Pairing-Token: YOUR_TOKEN" http://127.0.0.1:31337/health/private
```

### Q: TypeScript 编译错误？

```bash
npm run typecheck
```

### Q: 端口被占用？

```bash
# 查看占用端口的进程
netstat -ano | findstr :31337

# 或使用其他端口
PORT=31338 npm start
```

### Q: 如何查看日志？

服务日志直接输出到终端。如需持久化：
```bash
npm start 2>&1 | tee cli-bridge.log
```

## 核心概念

| 概念 | 说明 |
|------|------|
| **Goal** | 目标 - 要完成的高层任务 |
| **Plan** | 计划 - 实现 Goal 的步骤列表 |
| **Gate** | 门控 - 变更操作需要人工审批 |
| **Loop** | 循环 - 自动推进 Plan 执行的机制 |
| **Relay** | 中继 - CLI ↔ ChatGPT 之间的上下文传递 |

## 下一步

- 查看 [docs/goal-instruction-framework.md](docs/goal-instruction-framework.md) 了解 Goal 驱动框架
- 查看 [docs/adr/](docs/adr/) 了解架构决策
- 查看 [docs/runbooks/](docs/runbooks/) 了解运维手册
