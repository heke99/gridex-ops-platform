/**
 * Reality scenario D — a tenant employee registers a customer by hand (docs/testing/verklighetssimulering-runbook.md).
 *
 * A real company_admin user fills /admin/customers/intake: a private customer switching supplier, the facility
 * address, a shared registry grid owner, the published offer, an uploaded signed agreement and an uploaded
 * signed power of attorney. The scenario then proves what was stored (rows, storage objects, hashes, the
 * authority chain) and that the facility-information request reaches the grid owner with that exact power of
 * attorney attached (Resend simulator, sha256 of the attachment). Synthetic people only (example.invalid).
 */
import { createHash, randomInt } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { supabaseService } from '@/lib/supabase/service'
import { configureTenant, literal, sql, type LiveTenant } from '../helpers/live-chain-fixture'
import { addGridOwnerContactChannel, checkGridOwners, closeOperatorConsole, importActorRegistry, operatorSession, sanitizedActorRegistry,
  submitManualIntake, verifyActorForCustomerFlow } from '../helpers/reality/operatorConsole'
import { configurePlatformManualMailbox } from '../helpers/reality/tenantWebsite'
import { createTenantStaff } from '../helpers/reality/tenantStaff'
import { runOperationalCronSlot } from '../helpers/reality/world'

const GRID_OWNER_EDIEL_ID = '16700'
const GRID_OWNER_NAME = 'Alingsås Energi Elnät AB'
const GRID_OWNER_FACILITY_CONTACT = `anlaggning-${GRID_OWNER_EDIEL_ID}@example.invalid`
const report: Record<string, unknown> = { scenario: 'D manual intake', startedAt: new Date().toISOString() }
let tenant: LiveTenant
const files = mkdtempSync(join(tmpdir(), 'reality-d-'))

/** A small, valid one-page PDF with the given text (synthetic document). */
function pdf(text: string) {
  const stream = `BT /F1 12 Tf 72 720 Td (${text.replace(/[()\\]/g, '')}) Tj ET`
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
  let body = '%PDF-1.4\n'; const offsets: number[] = []
  objects.forEach((object, index) => { offsets.push(body.length); body += `${index + 1} 0 obj\n${object}\nendobj\n` })
  const xref = body.length
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(body, 'latin1')
}
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

/** A synthetic Swedish personal number (12 digits) with a valid Luhn check digit. */
function personalNumber() {
  const base = `1985${String(randomInt(1, 13)).padStart(2, '0')}${String(randomInt(1, 29)).padStart(2, '0')}${String(randomInt(200, 999))}`
  const digits = base.slice(2).split('').map(Number)
  const sum = digits.reduce((acc, digit, index) => { const value = index % 2 === 0 ? digit * 2 : digit; return acc + (value > 9 ? value - 9 : value) }, 0)
  return `${base}${(10 - (sum % 10)) % 10}`
}

describe.sequential('reality D — manual customer intake by a tenant employee', () => {
  afterAll(async () => {
    await closeOperatorConsole()
    report.finishedAt = new Date().toISOString()
    writeFileSync(process.env.GRIDEX_REALITY_REPORT ?? '/tmp/reality-d-report.json', JSON.stringify(report, null, 2))
  })

  const person = { firstName: 'Klara', lastName: `Manuell-${randomInt(1000, 9999)}`, personalNumber: personalNumber() }
  const agreementPdf = pdf(`Elavtal ${person.firstName} ${person.lastName} signerat`)
  const poaPdf = pdf(`Fullmakt ${person.firstName} ${person.lastName} signerad`)
  const agreementPath = join(files, 'avtal.pdf'), poaPath = join(files, 'fullmakt.pdf')
  writeFileSync(agreementPath, agreementPdf); writeFileSync(poaPath, poaPdf)
  let customerId = ''

  it('D1 the tenant employee registers the customer with the signed agreement and power of attorney', async () => {
    tenant = await configureTenant(supabaseService as never)
    // Platform staff: Ediel's actor registry, the area's grid owner verified for the customer flow and its
    // facility-information contact, and the platform's manual-operations mailbox.
    const staffOperator = await operatorSession(tenant.operatorEmail, tenant.operatorPassword)
    report.registryImport = await importActorRegistry(staffOperator, sanitizedActorRegistry().path)
    report.gridOwnerVerification = await verifyActorForCustomerFlow(staffOperator, GRID_OWNER_NAME)
    report.gridOwnerCheck = await checkGridOwners(staffOperator)
    const gridOwnerId = sql<string>(`SELECT to_jsonb(id::text) FROM public.grid_owners WHERE ediel_id=${literal(GRID_OWNER_EDIEL_ID)} AND company_id IS NULL`)
    report.contactChannel = await addGridOwnerContactChannel(staffOperator, gridOwnerId, GRID_OWNER_FACILITY_CONTACT)
    configurePlatformManualMailbox()
    // The tenant's own employee does the intake.
    const employee = await createTenantStaff(tenant.companyId)
    const staff = await operatorSession(employee.email, employee.password)
    const today = new Date().toISOString().slice(0, 10)
    const intake = await submitManualIntake(staff, { ...person, email: `klara-${randomInt(1000, 9999)}@example.invalid`, phone: '0701234567',
      street: 'Kungsgatan 12', postalCode: '441 30', city: 'Alingsås', siteName: 'Bostad Kungsgatan', gridOwnerId, priceAreaCode: 'SE3',
      annualConsumptionKwh: '14000', contractOfferId: tenant.offerId, contractStartDate: today, signedAgreementPdf: agreementPath,
      powerOfAttorneyPdf: poaPath, validFrom: today, requestTarget: 'grid_owner' })
    report.intake = intake
    customerId = sql<string>(`SELECT coalesce(to_jsonb(max(id::text)),'null') FROM public.customers WHERE company_id=${literal(tenant.companyId)} AND personal_number=${literal(person.personalNumber)}`)
    expect(intake.actionStatus, intake.text).toBe(200)
    expect(customerId, intake.text).toBeTruthy()
  }, 15 * 60_000)

  it('D2 everything is stored on this tenant and customer: rows, files and the authority chain', async () => {
    const stored = sql<Record<string, unknown>>(`SELECT jsonb_build_object(
      'registeredAddress',(SELECT count(*) FROM public.customer_addresses a WHERE a.customer_id=${literal(customerId)} AND a.company_id=${literal(tenant.companyId)} AND a.type='registered' AND a.street_1='Kungsgatan 12'),
      'sites',(SELECT jsonb_agg(jsonb_build_object('grid_owner',s.grid_owner_id IS NOT NULL,'company',s.company_id=${literal(tenant.companyId)})) FROM public.customer_sites s WHERE s.customer_id=${literal(customerId)}),
      'poa',(SELECT jsonb_agg(jsonb_build_object('status',p.status,'company',p.company_id=${literal(tenant.companyId)},'path',p.document_path,'hash',p.document_hash,'signer',p.signer_name,'method',p.method,'scopes',p.signed_scope_snapshot)) FROM public.powers_of_attorney p WHERE p.customer_id=${literal(customerId)}),
      'documents',(SELECT jsonb_agg(jsonb_build_object('type',d.document_type,'status',d.status,'company',d.company_id=${literal(tenant.companyId)},'checksum',d.file_checksum,'path',d.file_path,'poa',d.power_of_attorney_id IS NOT NULL)) FROM public.customer_authorization_documents d WHERE d.customer_id=${literal(customerId)}),
      'scopes',(SELECT jsonb_agg(jsonb_build_object('grid_owner_data',s.covers_grid_owner_data,'status',s.status)) FROM public.authorization_scopes s WHERE s.customer_id=${literal(customerId)}),
      'contracts',(SELECT jsonb_agg(jsonb_build_object('status',c.status,'company',c.company_id=${literal(tenant.companyId)},'document',c.document_sha256)) FROM public.customer_contracts c WHERE c.customer_id=${literal(customerId)}),
      'contractDocuments',(SELECT jsonb_agg(jsonb_build_object('type',d.document_type,'sha',d.document_sha256,'verified',d.verified_at IS NOT NULL)) FROM public.customer_contract_documents d JOIN public.customer_contracts c ON c.id=d.customer_contract_id WHERE c.customer_id=${literal(customerId)}))`)
    report.stored = stored
    const poa = (stored.poa as Array<Record<string, unknown>> | null)?.[0]
    // The uploaded power of attorney is in storage, byte for byte.
    const download = poa?.path ? await supabaseService.storage.from('customer-documents').download(String(poa.path)) : null
    const storedPoa = download?.data ? Buffer.from(await download.data.arrayBuffer()) : null
    report.storedPoaSha256 = storedPoa ? sha256(storedPoa) : null
    expect(stored.registeredAddress).toBe(1)
    expect(stored.sites).toEqual([{ grid_owner: true, company: true }])
    expect(poa, JSON.stringify(stored)).toMatchObject({ company: true, hash: sha256(poaPdf) })
    expect(report.storedPoaSha256).toBe(sha256(poaPdf))
    expect((stored.documents as Array<Record<string, unknown>>).find(d => d.type === 'power_of_attorney')).toMatchObject({ status: 'active', company: true, checksum: sha256(poaPdf), poa: true })
    expect(stored.scopes).toEqual(expect.arrayContaining([expect.objectContaining({ grid_owner_data: true, status: 'active' })]))
    expect((stored.contractDocuments as Array<Record<string, unknown>> | null) ?? []).toEqual(expect.arrayContaining([expect.objectContaining({ sha: sha256(agreementPdf), verified: true })]))
  })

  it('D3 the grid owner receives the facility-information request with exactly that power of attorney attached', async () => {
    const deadline = Date.now() + Number(process.env.GRIDEX_REALITY_D3_MINUTES ?? 6) * 60_000
    let outbox: Array<Record<string, unknown>> = []
    for (;;) {
      await runOperationalCronSlot()
      outbox = sql(`SELECT coalesce(jsonb_agg(jsonb_build_object('status',o.status,'to',o.to_email,'company',o.company_id=${literal(tenant.companyId)},
        'blocked',o.blocked_reason,'attachments',(SELECT jsonb_agg(jsonb_build_object('filename',a->>'filename','sha256',a->>'sha256','kind',a->>'kind')) FROM jsonb_array_elements(coalesce(o.attachments,'[]')) a))),'[]')
        FROM public.manual_email_outbox o JOIN public.grid_owner_information_requests r ON r.id=o.request_id WHERE r.customer_id=${literal(customerId)}`)
      if (outbox.some(row => row.status === 'sent') || Date.now() > deadline) break
      await new Promise(resolve => setTimeout(resolve, 30_000))
    }
    report.manualOutbox = outbox
    report.facilityLookup = sql(`SELECT coalesce(jsonb_agg(jsonb_build_object('status',r.status,'dispatch',r.dispatch_status,'error',r.last_error_code,'message',left(coalesce(r.last_error_message,r.dispatch_error_message,''),200),'poa',r.poa_id IS NOT NULL,'company',r.company_id=${literal(tenant.companyId)})),'[]')
      FROM public.grid_owner_information_requests r WHERE r.customer_id=${literal(customerId)}`)
    const sim = await fetch('http://127.0.0.1:3901/__sim/state').then(r => r.json()) as { emails: Array<{ to: unknown; subject: unknown; attachments: Array<{ sha256: string; pdf: boolean }> }> }
    const delivered = sim.emails.filter(mail => JSON.stringify(mail.to).includes(GRID_OWNER_FACILITY_CONTACT))
    report.deliveredToGridOwner = delivered
    expect(outbox, JSON.stringify(report.facilityLookup)).toEqual(expect.arrayContaining([expect.objectContaining({ status: 'sent', company: true })]))
    expect(delivered.flatMap(mail => mail.attachments.map(a => a.sha256)), JSON.stringify(delivered)).toContain(sha256(poaPdf))
  }, 15 * 60_000)

  it('D9 the stored documents are readable again from storage after the request', () => {
    expect(readFileSync(poaPath).equals(poaPdf)).toBe(true)
  })
})
