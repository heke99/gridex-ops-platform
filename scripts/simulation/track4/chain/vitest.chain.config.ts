// Vitest config for the T4 source-chain run (chain/t4-source-chain.chain.test.ts). Same alias set as the project's native
// suites (scripts/ediel-source-owner-native.config.ts) but reading its Supabase target from the T4 environment
// (SIM_HOME/env, exported by run.sh/chain.sh), never from a CLI status file, and refusing anything but the default local API.
import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

const root = resolve(__dirname, '../../../..')
if (process.env.NEXT_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:54321') throw new Error('t4_chain_requires_the_t4_stack_environment')
if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) throw new Error('t4_chain_env_incomplete')

export default defineConfig({
  root,
  resolve: { alias: [
    { find: '@', replacement: root },
    { find: /^server-only$/, replacement: resolve(root, 'node_modules/next/dist/compiled/server-only/empty.js') },
  ] },
  test: {
    environment: 'node',
    include: ['scripts/simulation/track4/chain/*.chain.test.ts'],
    setupFiles: ['scripts/helpers/ediel-native-permission-catalog.setup.ts'], // permission catalog reference keys (needs the default 54321/54322 stack)
    fileParallelism: false, retry: 0, testTimeout: 3_600_000, hookTimeout: 600_000,
    reporters: ['default', 'json'],
    outputFile: { json: process.env.T4_CHAIN_VITEST_JSON ?? resolve(process.env.SIM_HOME ?? '/tmp', 'chain-vitest.json') },
  },
})
