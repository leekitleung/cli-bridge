# Round 8: Zero-Doc User Review - blockers.md

## P1 Blockers (Should Fix)

### ZU-R8-001: docs/ 目录文档混乱
- **Severity:** P1
- **Files:** docs/README.md (缺失), docs/getting-started.md (缺失), docs/faq.md (缺失)
- **Issue:** 200+ 文件包含大量内部规划文档、ADR、技术规格，新用户难以找到关键信息
- **Fix:** 创建 docs/README.md 作为索引，增加 Getting Started 和 FAQ 文档

### ZU-R8-002: README.md 缺少故障排除部分
- **Severity:** P1
- **File:** README.md
- **Issue:** 用户首次使用时遇到问题无法通过文档自助解决
- **Fix:** 增加 Troubleshooting/FAQ 部分，覆盖常见错误场景

## P2 Blockers (Consider Fixing)

### ZU-R8-003: 文档语言不统一
- **Severity:** P2
- **Files:** docs/goal-directive.md, docs/goal-experiment-tracker.md
- **Issue:** goal-instruction-framework.md 是英文，但其他是中文

### ZU-R8-004: 缺少截图/视频演示
- **Severity:** P2
- **File:** README.md
- **Issue:** 用户无法直观了解最终效果
