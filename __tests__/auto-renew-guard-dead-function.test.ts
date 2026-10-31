// simulation: 20261029-3f1a8ab1/claude-track2/002
//
// Lifecycle note: public.gridex_customer_contracts_auto_renew_guard() (last
// defined in supabase/migrations/20261028091248_allow_contract_signature_before_supply_start.sql)
// is DEAD CODE. No trigger attaches it, and it calls
// public.gridex_add_months_timestamptz, which is never created. customer_contracts.ends_at
// is derived in the application (lib/customer-contracts/lifecycle.ts deriveContractEndsAt).
// Attaching the guard requires a migration that also creates
// gridex_add_months_timestamptz, plus an owner decision. This test fails if any
// migration or supabase/schema.sql attaches it.
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(__dirname, '..')
const MIGRATIONS_DIR = join(ROOT, 'supabase/migrations')
const SCHEMA_FILE = join(ROOT, 'supabase/schema.sql')

const ATTACH_PATTERN =
  /execute\s+(?:function|procedure)\s+(?:(?:"?public"?)\s*\.\s*)?"?gridex_customer_contracts_auto_renew_guard"?\s*\(/i

function findAutoRenewGuardAttachments(sql: string): string[] {
  const hits: string[] = []
  for (const statement of sql.split(';')) {
    if (/create\s+(?:or\s+replace\s+)?(?:constraint\s+)?trigger/i.test(statement) && ATTACH_PATTERN.test(statement)) {
      hits.push(statement.trim().slice(0, 300))
    }
  }
  return hits
}

function deadCodeMessage(file: string, hits: string[]): string {
  return (
    `${file} attaches public.gridex_customer_contracts_auto_renew_guard() as a trigger. ` +
    'The function is dead code (simulation finding 20261029-3f1a8ab1/claude-track2/002) and must not be ' +
    'attached without a migration that also creates public.gridex_add_months_timestamptz and an explicit owner decision.\n' +
    hits.join('\n---\n')
  )
}

describe('gridex_customer_contracts_auto_renew_guard stays detached (finding 002)', () => {
  it('detects a synthetic CREATE TRIGGER attaching the guard (negative case)', () => {
    const variants = [
      'CREATE TRIGGER t BEFORE INSERT OR UPDATE ON public.customer_contracts FOR EACH ROW EXECUTE FUNCTION public.gridex_customer_contracts_auto_renew_guard();',
      'create or replace trigger t before update on customer_contracts for each row execute procedure gridex_customer_contracts_auto_renew_guard();',
      'CREATE TRIGGER t BEFORE INSERT ON "public"."customer_contracts" FOR EACH ROW EXECUTE FUNCTION "public"."gridex_customer_contracts_auto_renew_guard"();',
      'CREATE TRIGGER t\n  BEFORE INSERT ON public.customer_contracts\n  FOR EACH ROW\n  EXECUTE   FUNCTION  public . gridex_customer_contracts_auto_renew_guard ( );',
    ]
    for (const sql of variants) {
      expect(findAutoRenewGuardAttachments(sql), sql).toHaveLength(1)
    }
  })

  it('does not flag the function definition or grants', () => {
    const sql =
      'create or replace function public.gridex_customer_contracts_auto_renew_guard() returns trigger language plpgsql as $f$ begin return new; end $f$;\n' +
      'GRANT ALL ON FUNCTION public.gridex_customer_contracts_auto_renew_guard() TO service_role;'
    expect(findAutoRenewGuardAttachments(sql)).toEqual([])
  })

  it('no migration attaches the guard as a trigger', () => {
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      const hits = findAutoRenewGuardAttachments(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'))
      expect(hits, deadCodeMessage(`supabase/migrations/${file}`, hits)).toEqual([])
    }
  })

  it('supabase/schema.sql does not attach the guard as a trigger', () => {
    const hits = findAutoRenewGuardAttachments(readFileSync(SCHEMA_FILE, 'utf8'))
    expect(hits, deadCodeMessage('supabase/schema.sql', hits)).toEqual([])
  })
})
