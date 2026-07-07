# Round 8: Native Designer Review - blockers.md

## P0 Blockers (Must Fix)

### ND-P0-1: 状态颜色暗色模式缺失
- **Severity:** P0
- **File:** `apps/extension/src/ui/state.ts`
- **Lines:** 193-208
- **Issue:** getPanelStatusColor() 仅定义浅色模式颜色，暗色模式对比度不足
- **Impact:** 暗色模式下状态颜色不可见
- **Fix:** 添加暗色模式颜色分支

### ND-P0-2: 按钮 disabled 状态视觉反馈不足
- **Severity:** P0
- **File:** `apps/extension/src/ui/bridge-panel.tsx`
- **Lines:** 531-533
- **Issue:** opacity: 0.55 在暗色模式下区分度低
- **Impact:** 用户无法区分启用/禁用按钮
- **Fix:** 增加 filter: saturate(0.3) 或使用灰色背景

## P1 Blockers (Should Fix)

### ND-P1-1: 按钮缺少 hover/active 状态
- **Severity:** P1
- **File:** `apps/extension/src/ui/bridge-panel.tsx`
- **Issue:** 仅定义了 focus-visible，无 hover/active 样式
- **Fix:** 添加 button:hover, button:active 样式

### ND-P1-2: monospace 字体栈不完整
- **Severity:** P1
- **File:** `apps/extension/src/ui/bridge-panel.tsx`
- **Line:** 487
- **Issue:** 'ui-monospace' 不是有效字体名
- **Fix:** 改为 'SFMono-Regular', Consolas, monospace

### ND-P1-3: Popup vs Panel 颜色系统不一致
- **Severity:** P1
- **Files:** popup/index.ts, bridge-panel.tsx
- **Issue:** --bg: #f7f7f5 vs --cb-panel-bg: #ffffff
- **Fix:** 统一为同一色值
