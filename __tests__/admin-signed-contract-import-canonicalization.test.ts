import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const migration = readFileSync(
  resolve(__dirname, '../supabase/migrations/20260831095000_admin_signed_contract_import_canonicalization.sql'),
  'utf8',
)

describe('canonical admin signed contract import', () => {
  it('never sends an admin signed-document intake directly into signed or active state', () => {
    expect(migration).toContain("v_has_signed_document and v_status in ('signed', 'active')")
    expect(migration).toContain("case when v_has_catalog_offer then 'pending_signature' else 'draft' end")
    expect(migration).toContain("'{contract,signed_at}', 'null'::jsonb")
    expect(migration).toContain("return public.gridex_onboard_customer_graph(v_command)")
  })

  it('keeps manual one-off contracts mutable until their exact canonical chain exists', () => {
    expect(migration).toContain("not v_has_catalog_offer and v_status = 'pending_signature'")
    expect(migration).toContain("public.gridex_prepare_manual_contract_binding")
    expect(migration).toContain("admin_signed_contract_import_exact_contract_chain_missing")
    expect(migration).toContain("admin_signed_contract_import_versions_not_locked")
  })

  it('requires an actual tenant-scoped signed PDF with a sha256 before finalization', () => {
    expect(migration).toContain("new.document_type <> 'complete_agreement'")
    expect(migration).toContain("new.metadata->>'source'")
    expect(migration).toContain("new.metadata->>'documentRole'")
    expect(migration).toContain("new.file_checksum, '') !~ '^[0-9a-f]{64}$'")
    expect(migration).toContain("admin_signed_contract_import_pdf_required")
    expect(migration).toContain("and customer_id = new.customer_id")
  })

  it('replaces the thin intake price snapshot with an exact signed canonical receipt', () => {
    expect(migration).toContain("'gridex_contract_pricing_v7_signed_receipt'")
    expect(migration).toContain("'admin_signed_document_import'")
    expect(migration).toContain("'signed_document_sha256', new.file_checksum")
    expect(migration).toContain("contract_price_snapshot_id = v_snapshot_id")
    expect(migration).toContain("private.gridex_normalize_fixed_area_snapshot_v1")
  })

  it('creates immutable document, acceptance, legal and signature evidence before signed state', () => {
    const documentPosition = migration.indexOf('insert into public.customer_contract_documents')
    const acceptancePosition = migration.indexOf('insert into public.customer_contract_acceptances')
    const evidencePosition = migration.indexOf('insert into public.customer_contract_evidence')
    const signedUpdatePosition = migration.indexOf("set status = 'signed'")

    expect(documentPosition).toBeGreaterThan(0)
    expect(acceptancePosition).toBeGreaterThan(documentPosition)
    expect(evidencePosition).toBeGreaterThan(acceptancePosition)
    expect(signedUpdatePosition).toBeGreaterThan(evidencePosition)
    expect(migration).toContain("'signed_contract_pdf'")
    expect(migration).toContain("'imported_signed_document'")
    expect(migration).toContain("'admin_manual'")
    expect(migration).toContain('document_sha256 = new.file_checksum')
  })

  it('does not reuse the Fakturatest synthetic signature path for real customers', () => {
    expect(migration).not.toContain('Gridex Fakturatest synthetic acceptance')
    expect(migration).not.toContain('gridex_finalize_customer_contract_signature_v1')
    expect(migration).toContain("'timestamp_semantics', 'administrative_import_time_original_signature_time_not_supplied'")
  })

  it('installs a narrowly scoped document trigger and removes direct function execution', () => {
    expect(migration).toContain('zz_customer_authorization_documents_finalize_signed_agreement_v1')
    expect(migration).toContain('after insert or update of status, customer_contract_id, file_checksum, metadata')
    expect(migration).toContain('revoke all on function public.gridex_finalize_admin_imported_signed_agreement_v1() from authenticated')
  })
})
