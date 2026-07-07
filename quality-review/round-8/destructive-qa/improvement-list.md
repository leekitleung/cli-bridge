# Round 8: Destructive QA Review - improvement-list.md

## 立即验证

1. **H-1 验证**: cmd.exe allowlist 修复
   - 操作: 测试 cmd.exe /c net user attacker P@ssw0rd /add 被阻止
   - 操作: 测试 cmd.exe /c echo hello 被允许
   - 验收: 安全命令通过，危险命令被阻止

2. **H-2 验证**: 工作目录逃逸修复
   - 操作: 测试 workingDirectory: '../../../root' 被阻止
   - 验收: 路径遍历请求被拒绝

## P2 修复

3. **M-2**: 消除 token 长度时序泄露
   - 文件: pairing.ts
   - 操作: 使用 timingSafeEqual 比较固定长度哈希
   - 验收: 时序攻击无法确定 token 长度

4. **M-3**: 添加原子 nonce 声明
   - 文件: local-auto-pair-session.ts
   - 操作: 使用 Map.has/set 原子操作
   - 验收: 并发请求无法重复使用 nonce

## P3 优化

5. **M-1**: 实现滑动窗口限速
6. **L-2**: 扩展敏感数据脱敏模式 (JWT, GCP)
7. **L-3**: 改进输出截断到行边界
8. **L-4**: 错误路径杀死进程
