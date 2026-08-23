import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migrationPath =
  'supabase/migrations/20260823204821_enforce_contract_price_snapshot_hash_integrity.sql'

function read(path: string): string {
  return readFileSync(path, 'utf8')
}

describe('contract price snapshot hash integrity', () => {
  it('computes a canonical SHA-256 after insert-time normalization', () => {
    const migration = read(migrationPath)

    expect(migration).toContain(
      'extensions.digest(convert_to(new.snapshot_json::text, \'UTF8\'), \'sha256\')',
    )
    expect(migration).toContain(
      'message = \'contract_price_snapshot_hash_mismatch\'',
    )
    expect(migration).toContain(
      'create trigger zzzz_contract_price_snapshots_hash_integrity_v1',
    )
    expect(migration).toContain('before insert on public.contract_price_snapshots')
  })

  it('repairs historical null hashes through the explicit maintenance escape hatch', () => {
    const migration = read(migrationPath)

    expect(migration).toContain("set local app.gridex_pricing_maintenance = 'on'")
    expect(migration).toContain('update public.contract_price_snapshots')
    expect(migration).toContain(
      "where nullif(btrim(coalesce(snapshot_hash, '')), '') is null",
    )
  })

  it('makes missing or malformed hashes impossible after convergence', () => {
    const migration = read(migrationPath)

    expect(migration).toContain('alter column snapshot_hash set not null')
    expect(migration).toContain(
      'add constraint contract_price_snapshots_snapshot_hash_sha256_check',
    )
    expect(migration).toContain("check (snapshot_hash ~ '^[0-9a-f]{64}$')")
  })

  it('keeps the website finalizer dependent on the immutable snapshot hash', () => {
    const signatureMigration = read(
      'supabase/migrations/20260718160000_v5_signature_switch_readiness_hardening.sql',
    )

    expect(signatureMigration).toContain("nullif(cps.snapshot_hash,'') is not null")
    expect(signatureMigration).toContain("message='exact_locked_contract_chain_invalid'")
  })
})
