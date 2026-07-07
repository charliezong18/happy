#!/bin/zsh
# Manual fallback for the deploy-pages.yml workflow: build the web app from the
# current checkout and force-push it to the fork's gh-pages branch.
set -euo pipefail
REPO="$(cd "$(dirname "$0")" && pwd)"
WT="$(mktemp -d)/gh-pages-wt"

cd "$REPO/packages/happy-app"
rm -rf dist
EXPO_WEB_BASE_URL=/happy npx expo export --platform web

cd "$REPO"
git worktree add --detach "$WT" >/dev/null
(
  cd "$WT"
  git checkout --orphan gh-pages-deploy >/dev/null 2>&1
  git rm -rfq .
  cp -R "$REPO/packages/happy-app/dist/." .
  touch .nojekyll
  cp index.html 404.html
  git add -A
  git commit -q -m "deploy: web build $(date +%Y-%m-%d_%H%M)"
  git push -f fork HEAD:gh-pages
)
git worktree remove --force "$WT"
echo "✓ deployed → https://charliezong18.github.io/happy/"
