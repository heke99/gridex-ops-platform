// Bridges scripts/ediel-registry-market-sql-regression.mjs (EDIEL_REGISTRY_PROBE_MODULE)
// into an in-process vitest probe registered on globalThis before import.
export default async function probe(context) {
  const run = globalThis.__edielRegistryProbe
  if (typeof run !== 'function') throw new Error('ediel_registry_probe_not_registered')
  await run(context)
}
