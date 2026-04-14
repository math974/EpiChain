#!/usr/bin/env bash
# Run from repo root:  bash scripts/commit-all.sh
# Activates .githooks/prepare-commit-msg so Cursor cannot leave Co-authored-by / Made-with lines.
# Also turn off: Cursor Settings → Agent → Attribution
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f .githooks/prepare-commit-msg ]; then
  echo "Missing .githooks/prepare-commit-msg" >&2
  exit 1
fi
chmod +x .githooks/prepare-commit-msg
git config core.hooksPath .githooks

commit_staged() {
  local msg=$1
  if git diff --cached --quiet; then
    return 0
  fi
  git commit -m "$msg"
}

# 1) gitignore (skip if unchanged: nothing staged)
git add .gitignore 2>/dev/null || true
commit_staged "chore: extend gitignore for Foundry, Prisma, and Node" || true

# 2) Hook (first time only)
git add .githooks/prepare-commit-msg
commit_staged "chore(git): add prepare-commit-msg hook to strip Cursor attribution"

# 3) Contracts
git add .gitmodules contracts/
commit_staged "feat(contracts): add Foundry project with forge-std submodule"

git add indexer/
commit_staged "feat(indexer): add Express API, Prisma, and Docker multi-stage image"

git add frontend/
commit_staged "feat(frontend): add React app with Vite, RainbowKit, and Docker"

git add docker-compose.yml .env.docker.example
commit_staged "chore(docker): add Compose stack and root env template"

git add scripts/
commit_staged "feat(scripts): add clean_rebuild and commit-all helpers"

git add README.md
commit_staged "docs: add project README and setup guide"

echo "Done."
git log --oneline -15
