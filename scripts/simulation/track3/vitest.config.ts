// Spårets egen vitest-konfiguration: bara track3/scenarios. Körs av run.sh med SIM_HOME/env/track3.env laddad.
// root = detta spårs katalog (scenariofilerna ligger här); appkoden (alias '@') ligger i körkatalogen.
import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

const here = __dirname
const appRoot = process.env.SIM_RUN_DIR ?? '/root/sim-run/track3'

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
