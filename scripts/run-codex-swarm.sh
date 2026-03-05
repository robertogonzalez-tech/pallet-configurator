#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="${1:-$(pwd)}"
WORKERS="${WORKERS:-20}"
CONCURRENCY="${CONCURRENCY:-5}"
MODEL="${MODEL:-gpt-5.3-codex}"
CODEX_BIN="${CODEX_BIN:-/Applications/Codex.app/Contents/Resources/codex}"

if [[ ! -x "$CODEX_BIN" ]]; then
  echo "codex binary not found at: $CODEX_BIN" >&2
  exit 1
fi

STAMP="$(date +%Y%m%d-%H%M%S)"
OUT_DIR="$REPO_DIR/docs/swarm/$STAMP"
mkdir -p "$OUT_DIR"

PROMPT_FILE="$OUT_DIR/swarm-prompt.txt"
cat > "$PROMPT_FILE" <<'EOF'
You are one worker in a 20-worker engineering swarm.

Goal:
Improve exact pallet/package accuracy, especially multi-family shipments, WITHOUT reducing within±1 reliability.

Constraints:
- Keep severe underprediction risk minimal.
- No giant rewrites.
- Focus on one highest-ROI patch idea.
- Use evidence from current code structure.

Return ONLY valid JSON:
{
  "worker_role": "string",
  "title": "short patch title",
  "why": "1-3 sentences",
  "files": ["path1","path2"],
  "patch_type": "rules|consolidation|classifier|diagnostics|history|evaluation",
  "expected_exact_gain_pts": number,
  "expected_within1_change_pts": number,
  "risk": "low|medium|high",
  "guardrails": ["..."],
  "implementation_steps": ["step1","step2","step3"],
  "rollback": ["step1","step2"]
}
EOF

ROLES=(
  "Multi-family consolidation specialist"
  "Double Docker packaging specialist"
  "VR2 and long-tube specialist"
  "Skatedock packaging specialist"
  "Classifier/alias mapping specialist"
  "NetSuite line-filter integrity specialist"
  "Calibration-rule simplification specialist"
  "Exact-match uplift specialist"
  "Leakage-safe history matching specialist"
  "Confidence/guardrail specialist"
  "Unknown SKU fallback specialist"
  "Underprediction risk specialist"
  "Overprediction trimming specialist"
  "Order signature feature engineer"
  "Package template normalizer"
  "Cross-family co-occurrence analyst"
  "Warehouse semantics specialist"
  "Evaluation-harness specialist"
  "Regression-test specialist"
  "Production safety specialist"
)

run_worker() {
  local idx="$1"
  local role="${ROLES[$((idx-1))]}"
  local out_file="$OUT_DIR/worker-$(printf "%02d" "$idx").json"
  local log_file="$OUT_DIR/worker-$(printf "%02d" "$idx").log"
  local now
  now="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

  {
    echo "[$now] starting worker $idx :: $role"
    {
      cat "$PROMPT_FILE"
      echo
      echo "Worker role: $role"
      echo
      echo "Repository root: $REPO_DIR"
    } | "$CODEX_BIN" exec \
      --ephemeral \
      --sandbox read-only \
      --model "$MODEL" \
      --skip-git-repo-check \
      -C "$REPO_DIR" \
      -o "$out_file" \
      -
    echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] done worker $idx"
  } > "$log_file" 2>&1
}

echo "Swarm run: $STAMP"
echo "Repo: $REPO_DIR"
echo "Workers: $WORKERS"
echo "Concurrency: $CONCURRENCY"
echo "Model: $MODEL"
echo "Output: $OUT_DIR"

for i in $(seq 1 "$WORKERS"); do
  while [[ "$(jobs -pr | wc -l | tr -d ' ')" -ge "$CONCURRENCY" ]]; do
    sleep 0.2
  done
  run_worker "$i" &
done

wait

echo
echo "Swarm complete. Outputs:"
echo "  $OUT_DIR"
echo "  (worker-XX.json + worker-XX.log)"
