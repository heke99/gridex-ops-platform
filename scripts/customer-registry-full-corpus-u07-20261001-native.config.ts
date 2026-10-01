import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'
import { REGISTRY_API, registryNativeEnvironment } from './customer-registry-full-corpus-u07-20261001-native.fixture'

const require = createRequire(import.meta.url)
const environment = registryNativeEnvironment(process.env)
process.env.NEXT_PUBLIC_SUPABASE_URL = REGISTRY_API
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = environment.anonKey
process.env.SUPABASE_SERVICE_ROLE_KEY = environment.serviceKey

export default defineConfig({
  resolve: { alias: [
    { find: /^server-only$/, replacement: require.resolve('next/dist/compiled/server-only/empty.js') },
    { find: '@', replacement: resolve(__dirname, '..') },
  ] },
  test: { environment: 'node', include: ['scripts/customer-registry-full-corpus-u07-20261001-native.test.ts'],
    testTimeout: 120_000, hookTimeout: 240_000, fileParallelism: false },
})
