# Round 8+1: Security Fixes Applied

## Date
2026-07-07

## Fixes Applied

### H-1: cmd.exe allowlist bypass (FIXED)
- Added `WINDOWS_SAFE_BUILTINS` whitelist
- Added `validateWindowsCmdArgs()` function to validate `/c` arguments
- Only allows safe built-in commands: echo, type, cd, dir, net, etc.
- Blocks path traversal in cmd.exe arguments

### H-2: Working directory path traversal (FIXED)
- Added sandbox boundary validation
- Working directory must start with `sandboxRoot` (cwd)
- Returns `working-directory-escape-attempt` error if traversal detected

### Terminal Veteran: Output truncation logic (FIXED)
- Fixed proportional distribution of output cap between stdout and stderr
- Both streams are now properly capped proportionally

## Test Results
```
# tests 121
# pass 120
# fail 0
# skipped 1
```

## Files Modified
- `apps/local-server/src/workbuddy/command-backend.ts`

## Security Status
- H-1: FIXED
- H-2: FIXED
- Output truncation: FIXED
