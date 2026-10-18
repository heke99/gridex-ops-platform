/* eslint-disable @typescript-eslint/no-require-imports */
const { spawnSync } = require('node:child_process')
const path = require('node:path')

// This flag is supplied to one reviewed Vercel build. Normal builds and CI
// neither need provider access nor make paid calls.
if (process.env.GRIDEX_VERIFY_PRODUCTION_AI === '1') {
  const result = spawnSync(process.execPath, [
    path.join(process.cwd(), 'node_modules/vitest/vitest.mjs'), 'run',
    '__tests__/manual-mail-ai-production-smoke.test.ts',
  ], { stdio: 'inherit', timeout: 30_000 })
  if (result.status !== 0) {
    console.error('Production AI connection verification failed; deployment must not be promoted.')
    process.exit(1)
  }
}
