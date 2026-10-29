// Ren objektkonfig utan importer så att filen kan läsas utan att vitest resolvas från harnesskatalogen.
// run.sh anropar RUN_DIR/node_modules/.bin/vitest --root <harness> --config <denna>.
const runDir = process.env.RUN_DIR ?? '/root/sim/track2'

export default {
  resolve: { alias: [{ find: '@', replacement: runDir }] },
  test: {
    environment: 'node',
    include: ['scenarios/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
    sequence: { concurrent: false },
  },
}
