#!/usr/bin/env bash
set -euo pipefail

# Intentionally installed without changing package.json/package-lock.json.
# This keeps the existing application dependency lock stable while pinning the
# browser-quality toolchain used by CI and local E2E runs.
npm install --no-save --package-lock=false \
  @playwright/test@1.60.0 \
  @axe-core/playwright@4.11.3

npx playwright install --with-deps chromium
