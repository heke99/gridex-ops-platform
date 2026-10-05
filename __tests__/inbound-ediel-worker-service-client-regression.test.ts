import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('inbound Ediel worker authorization and Z02 gate', () => {
  it('uses the service client for ACK-driven switch state updates', () => {
    const source = readFileSync('lib/ediel/flows/inboundAckProcessing.ts', 'utf8')
    expect(source).toContain('const supabase = supabaseService;')
    expect(source).not.toContain('createSupabaseServerClient')
    expect(source).toContain('updateSupplierSwitchRequestStatus(supabase')
    expect(source).toContain('createSupplierSwitchEvent(supabase')
  })

  it('keeps a fail-closed payload gate before atomic Z02 apply', () => {
    const migration = readFileSync('supabase/migrations/20260903070000_harden_inbound_z02_required_payload_gate.sql', 'utf8')
    expect(migration).toContain('trg_customer_operation_job_z02_payload_validation')
    expect(migration).toContain("z02_payload_validation_status', 'valid'")
    expect(migration).toContain('z02_installation_id_line_item_mismatch')
    expect(migration).toContain('z02_end_user_identity_conflict')
    expect(migration).toContain('z02_installation_address_conflict')
  })
})
