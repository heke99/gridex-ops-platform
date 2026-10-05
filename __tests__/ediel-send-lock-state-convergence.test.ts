import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Ediel send-lock state convergence', () => {
  const migration = readFileSync(
    'supabase/migrations/20260903160000_ediel_send_lock_state_convergence.sql',
    'utf8',
  )
  const recoveryMigration = readFileSync(
    'supabase/migrations/20260903161000_ediel_send_lock_release_requeues_outbox.sql',
    'utf8',
  )

  it('keeps the legacy status projection derived from the canonical locked boolean', () => {
    expect(migration).toContain("new.status := case when coalesce(new.locked, true) then 'active' else 'released' end")
    expect(migration).toContain('before insert or update on public.ediel_send_locks')
  })

  it('repairs contradictory projections without choosing a new canonical lock state', () => {
    expect(migration).toContain("set status = case when locked then 'active' else 'released' end")
    expect(migration).toContain("where status is distinct from case when locked then 'active' else 'released' end")
    expect(migration).not.toMatch(/set\s+locked\s*=/i)
  })

  it('keeps the convergence trigger private', () => {
    expect(migration).toContain('create or replace function private.ediel_send_lock_state_convergence_trigger()')
    expect(migration).toContain('revoke all on function private.ediel_send_lock_state_convergence_trigger()')
  })

  it('requeues only rows stranded by the released canonical send lock', () => {
    expect(recoveryMigration).toContain("o.status = 'blocked'")
    expect(recoveryMigration).toContain("o.last_error = 'active_ediel_send_lock'")
    expect(recoveryMigration).toContain("p.state = 'live'")
    expect(recoveryMigration).toContain("set status = 'queued'")
    expect(recoveryMigration).toContain("l.locked = false")
    expect(recoveryMigration).toContain("coalesce(l.status, 'released') <> 'active'")
  })

  it('does not broadly requeue unrelated transport or business blockers', () => {
    expect(recoveryMigration).not.toContain("where o.status = 'blocked';")
    expect(recoveryMigration).not.toContain("where status = 'blocked';")
    expect(recoveryMigration).toContain("and o.sent_at is null")
  })
})
