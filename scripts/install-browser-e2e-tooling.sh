#!/usr/bin/env bash
set -euo pipefail

# @playwright/test and @axe-core/playwright are pinned in package.json/package-lock.json
# and installed by npm ci. This step only installs the reviewed Chromium runtime
# and its OS dependencies, avoiding a second npm dependency-tree mutation in CI.
npx playwright install --with-deps chromium
