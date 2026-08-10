// Generated cardinality verifier for pattern-tagged requirements.
import { readFileSync } from 'node:fs'

const grid = JSON.parse(readFileSync('quality/compensation_grid.json', 'utf8'))
const downgrades = JSON.parse(readFileSync('quality/compensation_grid_downgrades.json', 'utf8'))
const bugs = readFileSync('quality/BUGS.md', 'utf8')
const covered = new Set([...bugs.matchAll(/REQ-\d{3}\/cell-P\d{3}-GLOBAL/g)].map((match) => match[0]))
const downgraded = new Set(downgrades.downgrades.map((record) => record.cell_id))
const absent = Object.values(grid.reqs).flatMap((req) => req.cells).filter((cell) => !cell.present)
const missing = absent.filter((cell) => !covered.has(cell.cell_id) && !downgraded.has(cell.cell_id))
const invalidDowngrades = downgrades.downgrades.filter((record) =>
  !record.authority_ref || !record.site_citation || !record.falsifiable_claim ||
  !['out-of-scope', 'deprecated', 'platform-gated', 'handled-upstream', 'intentionally-partial'].includes(record.reason_class),
)

console.log(JSON.stringify({
  pattern_requirements: Object.keys(grid.reqs).length,
  cells: Object.values(grid.reqs).flatMap((req) => req.cells).length,
  absent_cells: absent.length,
  bug_covered_cells: absent.filter((cell) => covered.has(cell.cell_id)).length,
  downgraded_cells: absent.filter((cell) => downgraded.has(cell.cell_id)).length,
  missing_cells: missing.map((cell) => cell.cell_id),
  invalid_downgrades: invalidDowngrades.map((record) => record.cell_id),
}, null, 2))

process.exitCode = missing.length || invalidDowngrades.length ? 1 : 0
