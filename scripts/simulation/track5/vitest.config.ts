// Ren objektkonfig utan importer så att filen kan läsas utan att vitest resolvas från harnesskatalogen.
// run.sh anropar RUN_DIR/node_modules/.bin/vitest --root <harness> --config <denna>.
const runDir = process.env.RUN_DIR ?? '/root/sim/track5'

export default {
  // 'server-only' löses som i Next serverbygge (tom markör), som i scripts/ediel-source-owner-native.config.ts @ 1c0c088c.
  resolve: { alias: [{ find: '@', replacement: runDir }, { find: /^server-only$/, replacement: `${runDir}/node_modules/next/dist/compiled/server-only/empty.js` }] },
  test: {
    environment: 'node',
    include: ['scenarios/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
    sequence: { concurrent: false },
  },
}
