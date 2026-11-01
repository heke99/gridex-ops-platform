// Vitest config for track 1 scenario files. run.sh uses the harness checkout as
// root (node_modules symlinked from the run dir); '@' resolves into the
// unchanged campaign-base app checkout.
import path from 'node:path'
import { defineConfig } from 'vitest/config'

const appRoot = process.env.TRACK1_APP_DIR
if (!appRoot || !path.isAbsolute(appRoot)) throw new Error('TRACK1_APP_DIR must explicitly name the admitted application checkout')

export default defineConfig({
  resolve: { alias: [{ find: '@', replacement: path.resolve(appRoot) }] },
  server: { fs: { strict: false } },
  test: {
    environment: 'node',
    include: ['**/scripts/simulation/track1/scenarios/*.test.ts'],
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 600_000,
    hookTimeout: 600_000,
    bail: 0,
  },
})
