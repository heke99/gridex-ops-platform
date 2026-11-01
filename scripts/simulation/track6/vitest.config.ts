// Spårets egen vitest-konfiguration: bara track6/scenarios. run.sh läser privat env/track6.json som data.
// root = detta spårs katalog (scenariofilerna ligger här); appkoden (alias '@') ligger i körkatalogen.
import { isAbsolute, resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

const here = __dirname
const appRoot = process.env.SIM_RUN_DIR
if (!appRoot || !isAbsolute(appRoot)) throw new Error('SIM_RUN_DIR must explicitly name the admitted app checkout')

export default defineConfig({
  root: here,
  resolve: {
    alias: [
      // Samma uppslag som Next:s serverbygge använder för 'server-only' (jfr scripts/ediel-source-owner-native.config.ts).
      { find: /^server-only$/, replacement: resolve(appRoot, 'node_modules/next/dist/compiled/server-only/empty.js') },
      { find: '@', replacement: appRoot },
    ],
  },
  test: {
    environment: 'node',
    // Runs before scenario collection, including module-level fixture initialization.
    globalSetup: [resolve(here, 'lib/custody/restore.ts')],
    include: ['scenarios/**/*.test.ts'],
    testTimeout: 180_000,
    hookTimeout: 180_000,
    fileParallelism: false,
    pool: 'forks',
    maxWorkers: 1,
    // Ingen cache/watch i körkatalogen.
    cache: false as never,
    passWithNoTests: false,
  },
})
