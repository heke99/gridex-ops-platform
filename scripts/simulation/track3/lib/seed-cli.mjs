// CLI: node seed-cli.mjs --mode test|production --out <fixture.json>
// Kräver att SIM_HOME/env/track3.env är laddad (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ...).
import { writeFileSync } from 'node:fs'
import { seedFixture } from './seed.mjs'

const args = process.argv.slice(2)
const get = (flag, fallback) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : fallback }
const out = get('--out', null)
const mode = get('--mode', 'test')
const fixture = await seedFixture({ mode })
fixture.mode = mode
if (out) writeFileSync(out, JSON.stringify(fixture, null, 2), { mode: 0o600 })
console.log(JSON.stringify({ ok: true, companyId: fixture.companyId, actorUserId: fixture.actorUserId, mode }))
