#!/bin/bash
# Gate Bypass Test - Direct Test Script
# Tests actual bypass paths using the correct file formats

set -e
cd "$(dirname "$0")/../.."

GATE="node skills/release-quality-review/scripts/review-gate.mjs"
PROFILE="--profile release-gate"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

BYPASS_COUNT=0
BLOCKED_COUNT=0

log_bypass() {
    echo -e "${RED}⚠ BYPASS: $1${NC}"
    BYPASS_COUNT=$((BYPASS_COUNT + 1))
}

log_blocked() {
    echo -e "${GREEN}✓ BLOCKED: $1${NC}"
    BLOCKED_COUNT=$((BLOCKED_COUNT + 1))
}

log_info() {
    echo -e "${BLUE}ℹ $1${NC}"
}

cleanup() {
    rm -rf quality-reports/round-9001 quality-reports/round-9002 quality-reports/round-9003 \
           quality-reports/round-9004 quality-reports/round-9005 quality-reports/round-9006 \
           quality-reports/round-9007 quality-reports/round-9008 quality-reports/round-9009 \
           quality-reports/round-9010 quality-reports/round-9011 quality-reports/round-9012 \
           quality-reports/round-9013 quality-reports/round-9014 quality-reports/round-9015 \
           quality-reports/round-9016 quality-reports/round-9017 quality-reports/round-9018 \
           quality-reports/round-9019 quality-reports/round-9020 2>/dev/null || true
}

cleanup

echo "=========================================="
echo "Gate Bypass Test Suite"
echo "=========================================="
echo ""

# ==========================================
# SECTION 1: RESULT.YAML BYPASS
# ==========================================
echo ""
echo "=== SECTION 1: result.yaml BYPASS (Gate ignores result.yaml!) ==="
echo ""

# R1: result.yaml with score 100 - Gate ignores it!
log_info "R1: Creating result.yaml with score 100..."
mkdir -p quality-reports/round-9001/product-flow
cat > quality-reports/round-9001/product-flow/result.yaml << 'EOF'
reviewer: product-flow
score: 100
status: pass
recommendation: pass
redlines: []
blockers: []
EOF
result=$($GATE --round 9001 $PROFILE 2>&1)
if echo "$result" | grep -q "GATE FAILED"; then
    log_blocked "R1: result.yaml is ignored (correct behavior)"
else
    log_bypass "R1: result.yaml is NOT ignored"
fi
echo "Result: $result" | head -5

# ==========================================
# SECTION 2: score.md FORMAT TESTS
# ==========================================
echo ""
echo "=== SECTION 2: score.md FORMAT TESTS ==="
echo ""

# S1: Valid passing score
log_info "S1: Valid passing score (100/100)..."
mkdir -p quality-reports/round-9002/product-flow
cat > quality-reports/round-9002/product-flow/score.md << 'EOF'
# Product Flow Review
## Overall Score: 100/100
EOF
result=$($GATE --round 9002 $PROFILE 2>&1)
if echo "$result" | grep -q "product-flow.*100"; then
    log_blocked "S1: Score correctly parsed"
else
    echo "Result snippet: $(echo "$result" | grep -i product)"
fi

# S2: Score as string
log_info "S2: Score as string..."
mkdir -p quality-reports/round-9003/product-flow
cat > quality-reports/round-9003/product-flow/score.md << 'EOF'
# Product Flow Review
## Overall Score: "100"/100
EOF
result=$($GATE --round 9003 $PROFILE 2>&1)
if echo "$result" | grep -q "product-flow.*100"; then
    log_blocked "S2: String score handled correctly"
else
    echo "Result snippet: $(echo "$result" | grep -i product)"
fi

# S3: Score NaN
log_info "S3: Score NaN..."
mkdir -p quality-reports/round-9004/product-flow
cat > quality-reports/round-9004/product-flow/score.md << 'EOF'
# Product Flow Review
## Overall Score: NaN/100
EOF
result=$($GATE --round 9004 $PROFILE 2>&1)
if echo "$result" | grep -q "product-flow.*NaN\|product-flow.*null"; then
    log_bypass "S3: NaN score allowed"
else
    log_blocked "S3: NaN score rejected"
fi

# S4: Score out of range (1000)
log_info "S4: Score out of range (1000)..."
mkdir -p quality-reports/round-9005/product-flow
cat > quality-reports/round-9005/product-flow/score.md << 'EOF'
# Product Flow Review
## Overall Score: 1000/100
EOF
result=$($GATE --round 9005 $PROFILE 2>&1)
if echo "$result" | grep -q "product-flow.*1000"; then
    log_bypass "S4: Out-of-range score allowed"
else
    log_blocked "S4: Out-of-range score rejected"
fi

# ==========================================
# SECTION 3: REDLINES/BLOCKERS TESTS
# ==========================================
echo ""
echo "=== SECTION 3: REDLINES/BLOCKERS TESTS ==="
echo ""

# RL1: Redlines in score.md but not in blockers.md
log_info "RL1: Redlines in score.md but empty blockers.md..."
mkdir -p quality-reports/round-9006/product-flow
cat > quality-reports/round-9006/product-flow/score.md << 'EOF'
# Product Flow Review
## Overall Score: 95/100
## Redlines
- P0: Critical vulnerability
EOF
cat > quality-reports/round-9006/product-flow/blockers.md << 'EOF'
# Product Flow Blockers
无 P0 blockers。
EOF
result=$($GATE --round 9006 $PROFILE 2>&1)
if echo "$result" | grep -q "FAIL\|failed"; then
    log_blocked "RL1: Redlines in score.md detected"
else
    log_bypass "RL1: Redlines in score.md NOT detected"
fi

# RL2: Unicode blockers
log_info "RL2: Unicode P0 variants..."
mkdir -p quality-reports/round-9007/product-flow
cat > quality-reports/round-9007/product-flow/score.md << 'EOF'
# Product Flow Review
## Overall Score: 95/100
## Blockers
- P0﹗ Critical issue
EOF
result=$($GATE --round 9007 $PROFILE 2>&1)
if echo "$result" | grep -q "FAIL\|failed"; then
    log_blocked "RL2: Unicode blockers detected"
else
    log_bypass "RL2: Unicode blockers NOT detected"
fi

# RL3: Whitespace injection
log_info "RL3: Whitespace injection in priority..."
mkdir -p quality-reports/round-9008/product-flow
cat > quality-reports/round-9008/product-flow/score.md << 'EOF'
# Product Flow Review
## Overall Score: 95/100
## Blockers
- P0 : Critical issue
EOF
result=$($GATE --round 9008 $PROFILE 2>&1)
if echo "$result" | grep -q "FAIL\|failed"; then
    log_blocked "RL3: Whitespace-injected P0 detected"
else
    log_bypass "RL3: Whitespace-injected P0 NOT detected"
fi

# ==========================================
# SECTION 4: REVIEWER VALIDATION TESTS
# ==========================================
echo ""
echo "=== SECTION 4: REVIEWER VALIDATION TESTS ==="
echo ""

# V1: Case sensitivity
log_info "V1: Case sensitivity..."
mkdir -p quality-reports/round-9009/PRODUCT-FLOW
cat > quality-reports/round-9009/PRODUCT-FLOW/score.md << 'EOF'
# Product Flow Review
## Overall Score: 100/100
EOF
result=$($GATE --round 9009 $PROFILE 2>&1)
if echo "$result" | grep -q "PRODUCT-FLOW.*100"; then
    log_bypass "V1: Case mismatch NOT detected"
else
    log_blocked "V1: Case mismatch detected"
fi

# V2: Fake reviewer name
log_info "V2: Fake reviewer name..."
mkdir -p quality-reports/round-9010/fake-super-reviewer
cat > quality-reports/round-9010/fake-super-reviewer/score.md << 'EOF'
# Fake Review
## Overall Score: 100/100
EOF
result=$($GATE --round 9010 $PROFILE 2>&1)
if echo "$result" | grep -q "fake-super-reviewer.*100"; then
    log_bypass "V2: Fake reviewer NOT detected"
else
    log_blocked "V2: Fake reviewer detected"
fi

# V3: Required reviewer missing
log_info "V3: Required reviewer missing..."
mkdir -p quality-reports/round-9011/product-flow
cat > quality-reports/round-9011/product-flow/score.md << 'EOF'
# Product Flow Review
## Overall Score: 100/100
EOF
result=$($GATE --round 9011 $PROFILE 2>&1)
if echo "$result" | grep -q "GATE FAILED"; then
    log_blocked "V3: Missing reviewer detected"
else
    log_bypass "V3: Missing reviewer NOT detected"
fi

# ==========================================
# SECTION 5: SUMMARY.md / GATE-RESULT.JSON TESTS
# ==========================================
echo ""
echo "=== SECTION 5: SUMMARY.GATE-RESULT.JSON BYPASS ==="
echo ""

# G1: Manually set summary to PASS
log_info "G1: Manually set summary.md to PASS..."
mkdir -p quality-reports/round-9012/product-flow
cat > quality-reports/round-9012/product-flow/score.md << 'EOF'
# Product Flow Review
## Overall Score: 50/100
EOF
cat > quality-reports/round-9012/summary.md << 'EOF'
# Summary
All reviewers passed!
EOF
result=$($GATE --round 9012 $PROFILE 2>&1)
if echo "$result" | grep -q "GATE FAILED"; then
    log_blocked "G1: summary.md manually bypassed"
else
    log_bypass "G1: summary.md manually bypassed"
fi

# G2: gate-result.json with passed: true
log_info "G2: gate-result.json manually set to passed..."
mkdir -p quality-reports/round-9013/product-flow
cat > quality-reports/round-9013/product-flow/score.md << 'EOF'
# Product Flow Review
## Overall Score: 50/100
EOF
cat > quality-reports/round-9013/gate-result.json << 'EOF'
{"passed": true}
EOF
result=$($GATE --round 9013 $PROFILE 2>&1)
# Run again to see if it reads the JSON
if echo "$result" | grep -q "GATE FAILED"; then
    log_blocked "G2: gate-result.json bypass attempted"
else
    log_bypass "G2: gate-result.json bypass worked"
fi

# ==========================================
# SECTION 6: EVIDENCE VALIDATION TESTS
# ==========================================
echo ""
echo "=== SECTION 6: EVIDENCE VALIDATION ==="
echo ""

# E1: Evidence manifest with non-existent file
log_info "E1: Evidence manifest with non-existent file..."
mkdir -p quality-reports/round-9014/product-flow
mkdir -p quality-reports/round-9014/evidence
cat > quality-reports/round-9014/product-flow/score.md << 'EOF'
# Product Flow Review
## Overall Score: 100/100
EOF
cat > quality-reports/round-9014/evidence/manifest.yaml << 'EOF'
evidence:
  - path: non-existent.txt
    type: test-log
EOF
result=$($GATE --round 9014 $PROFILE 2>&1)
if echo "$result" | grep -q "GATE FAILED\|evidence.*missing\|evidence.*not.*found"; then
    log_blocked "E1: Missing evidence detected"
else
    log_bypass "E1: Missing evidence NOT detected"
fi

# ==========================================
# SECTION 7: HIDDEN FILES BYPASS
# ==========================================
echo ""
echo "=== SECTION 7: HIDDEN FILES BYPASS ==="
echo ""

# H1: Hidden reviewer with score 0
log_info "H1: Hidden reviewer directory..."
mkdir -p quality-reports/round-9015/product-flow
mkdir -p quality-reports/round-9015/.hidden-reviewer
cat > quality-reports/round-9015/product-flow/score.md << 'EOF'
# Product Flow Review
## Overall Score: 100/100
EOF
cat > quality-reports/round-9015/.hidden-reviewer/score.md << 'EOF'
# Hidden Review
## Overall Score: 0/100
## Blockers
- P0: Critical hidden blocker
EOF
result=$($GATE --round 9015 $PROFILE 2>&1)
if echo "$result" | grep -q "GATE FAILED\|hidden"; then
    log_blocked "H1: Hidden reviewer detected"
else
    log_bypass "H1: Hidden reviewer NOT detected"
fi

# ==========================================
# SUMMARY
# ==========================================
echo ""
echo "=========================================="
echo "TEST SUMMARY"
echo "=========================================="
echo ""
echo -e "${GREEN}Blocked (Safe): $BLOCKED_COUNT${NC}"
echo -e "${RED}Bypassed (Vulnerable): $BYPASS_COUNT${NC}"
echo ""

if [ $BYPASS_COUNT -gt 0 ]; then
    echo -e "${RED}⚠ WARNING: $BYPASS_COUNT bypass paths detected!${NC}"
else
    echo -e "${GREEN}✓ All bypass attempts blocked!${NC}"
fi

cleanup
