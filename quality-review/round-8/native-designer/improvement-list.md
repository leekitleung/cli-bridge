# Round 8: Native Designer Review - improvement-list.md

## P0 立即修复

1. **ND-P0-1**: 修复 getPanelStatusColor() 暗色模式支持
   - 文件: state.ts
   - 操作: 添加 prefers-color-scheme 检测，返回暗色颜色
   - 验收: 暗色模式下所有状态颜色可见

2. **ND-P0-2**: 改进按钮 disabled 状态
   - 文件: bridge-panel.tsx
   - 操作: 添加 filter: saturate(0.3) 或 background: #9ca3af
   - 验收: 禁用按钮与启用按钮有明显区分

## P1 近期修复

3. **ND-P1-1**: 添加按钮 hover/active 状态
   - 操作: button:hover { filter: brightness(0.95) }, button:active { transform: scale(0.98) }

4. **ND-P1-2**: 修复 monospace 字体栈
   - 操作: 替换 'ui-monospace' 为 'SFMono-Regular', Consolas, monospace

5. **ND-P1-3**: 统一颜色系统
   - 操作: 将 popup 颜色变量改为与 panel 一致

## P2 后续优化

6. 添加 CSS transitions 提高流畅度
7. 提取公共样式为 CSS 类
8. 考虑 CSS container queries
