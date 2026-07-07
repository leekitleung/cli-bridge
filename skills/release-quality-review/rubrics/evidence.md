# 证据收集指南 (Evidence Collection)

评审必须基于实际证据，不能基于猜测或推断。

## 证据类型

### 1. 代码证据

直接引用代码片段作为证据：
```markdown
**证据:** 在 `apps/local-server/src/routes/bridge-api.ts:123` 发现：
```typescript
const userInput = req.body.input; // 无任何验证
```
```

### 2. 运行证据

命令输出、测试结果、构建日志：
```markdown
**证据:** 运行 `npm test` 结果：
```
FAIL src/auth.test.ts
  Auth: should reject invalid token
    expect(received).toBe(expected)
    Expected: 401
    Received: 200
```
```

### 3. 截图证据

UI 评审需要截图：
```markdown
**证据:** [截图: 空状态界面.png]
- 加载 5 秒后显示白屏
- 无任何加载指示器
```

### 4. 文档证据

文档内容作为证据：
```markdown
**证据:** README.md 中无安装说明
```

## 证据要求

| Reviewer | 必须的证据 |
|----------|-----------|
| 产品闭环 | 实际运行截图、用户路径追踪 |
| 工程架构 | 代码片段、模块依赖图 |
| 验收发布 | 测试结果、构建日志 |
| 破坏性质量 | 安全测试输出、漏洞 POC |
| 原生审美 | 截图、设计对比 |
| 零文档新用户 | 从头安装日志 |
| 终端老兵 | 命令帮助输出、错误信息 |
| 数据安全 | 存储层代码、网络请求 |

## 无证据不评分

如果没有证据支撑，分数应默认为 0：
```markdown
## 评分
**功能完成度: 0/30**

**证据:** 无

无法验证功能是否完成，因为：
1. 无法运行应用（缺少配置文件）
2. 无法访问相关代码
```

## 证据保存

所有证据应保存到评审报告中：
```
quality-reports/round-1/
├── evidence/
│   ├── screenshot-1.png
│   ├── build-log.txt
│   └── test-output.txt
├── product-flow/
│   └── score.md
└── ...
```
