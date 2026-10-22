// reality-defects: (FINDINGS F51, owner decisions 2026-10-22)
// A Z03 with a start day other than today reads the end user's identity and registered address
// only from an approved customer masterdata declaration. The declaration is derived from the
// signed contract (website/online: the signed snapshot section whose lines are in the verified
// signed PDF; manual intake/imported: the staff member's registered-address entry) and a later
// address supersedes it from the change day. Proved with the real rule
// (ediel_prepare_customer_masterdata_v1 / basis_v1), the real address writer, section builder,
// PDF renderer and derivation owner on the disposable replay. Synthetic rows only; the signed
// contract rows are inserted directly (session_replication_role=replica) instead of through a
// full publication chain, with the exact signed fields the rule binds.
import { createHash, randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { supabaseService } from '@/lib/supabase/service'
import { recordRegisteredAddress } from '@/lib/customers/registeredAddress'
import { buildAgreementPdfBuffer, customerMasterdataPdfLines, type ContractCustomerMasterdataSection } from '@/lib/customer-contracts/agreementPdf'
import { CUSTOMER_CONTRACT_DOCUMENT_BUCKET, loadContractCustomerMasterdataSection } from '@/lib/customer-contracts/documents'
import { deriveContractCustomerMasterdata } from '@/lib/operations/switchCustomerMasterdataPreparation'
import { literal, nativeSql as sql } from './helpers/ediel-normal-switch-native-fixture'
import { createBilateralSourceOperator } from './helpers/ediel-bilateral-customer-native-fixture'

const companyA = randomUUID(), companyB = randomUUID()
let actorA = '', actorB = ''
const stockholmDay = (offsetDays = 0) => {
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  const date = new Date(`${today}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + offsetDays); return date.toISOString().slice(0, 10)
}
// A Z03 market start (start of the day, UTC+1 like prodatMarketMinuteToUtc).
const marketStart = (day: string) => `${day}T00:00:00+01:00`
const pdfBase = {
  companyName: 'Synthetic F51 Elhandel AB', organizationNumber: '5560000000', customerName: 'Synthetic customer', customerNumber: 'K-F51',
  contractNumber: 'AVT-F51', contractName: 'Synthetic rörligt', contractType: 'variable_monthly', signedAt: new Date(Date.now() - 2 * 86400000).toISOString(),
  startsAt: stockholmDay(30), offerReference: 'synthetic-f51-offer', legalVersions: [{ id: randomUUID(), type: 'terms', title: 'Villkor', version: '1' }],
}

function customer(company: string, fields: { name: string; personal?: string; org?: string }) {
  const id = randomUUID()
  sql(`INSERT INTO public.customers(id,company_id,first_name,last_name,full_name,name,personal_number,org_number,customer_type,email,is_test_data,source)
   VALUES(${literal(id)},${literal(company)},'Synthetic','F51',${literal(fields.name)},${literal(fields.name)},${fields.personal ? literal(fields.personal) : 'NULL'},${fields.org ? literal(fields.org) : 'NULL'},
   ${literal(fields.org ? 'company' : 'private')},${literal(`f51-${id}@example.invalid`)},true,'e2e_native');`)
  return id
}

/** A signed contract with its archived, verified signed PDF (bytes in Storage, hash bound on the contract). */
async function signedContract(input: { company: string; customer: string; signature: Record<string, unknown>; pdf: Buffer }) {
  const id = randomUUID(), hash = createHash('sha256').update(input.pdf).digest('hex'), path = `${input.company}/${id}/signed-contract-${hash}.pdf`
  const upload = await supabaseService.storage.from(CUSTOMER_CONTRACT_DOCUMENT_BUCKET).upload(path, input.pdf, { contentType: 'application/pdf', upsert: false })
  expect(upload.error).toBeNull()
  const signedAt = pdfBase.signedAt, snapshotHash = createHash('sha256').update(JSON.stringify(input.signature)).digest('hex')
  sql(`SET session_replication_role=replica;
   INSERT INTO public.customer_contracts(id,company_id,customer_id,status,contract_version,signed_version,signed_at,locked_at,document_sha256,signature_snapshot,signature_snapshot_sha256,metadata)
   VALUES(${literal(id)},${literal(input.company)},${literal(input.customer)},'signed','v1','test-v1',${literal(signedAt)},${literal(signedAt)},${literal(hash)},${literal(input.signature)}::jsonb,${literal(snapshotHash)},'{"test_center":{"kind":"f51_native"}}');
   INSERT INTO public.customer_contract_documents(company_id,customer_contract_id,document_type,storage_bucket,storage_path,mime_type,document_sha256,generated_at,generation_snapshot,archived_at,verified_at)
   VALUES(${literal(input.company)},${literal(id)},'signed_contract_pdf',${literal(CUSTOMER_CONTRACT_DOCUMENT_BUCKET)},${literal(path)},'application/pdf',${literal(hash)},${literal(signedAt)},'{"synthetic":true}',${literal(signedAt)},${literal(signedAt)});`)
  return { id, hash }
}

const websiteSignature = (customerId: string, section: ContractCustomerMasterdataSection | null) => ({
  schema: section ? 'gridex_website_contract_signature_v3' : 'gridex_website_contract_signature_v2', company_id: companyA, customer_id: customerId,
  agreement_channel: 'website', accepted_at: pdfBase.signedAt, ...(section ? { customer_masterdata: section } : {}),
})
const tokenSignature = (customerId: string) => ({ schema: 'gridex_online_contract_signature_v1', company_id: companyA, customer_id: customerId, recipient_email: 'synthetic@example.invalid' })

async function prepare(company: string, customerId: string, asOf: string, actor = actorA) {
  const { data, error } = await supabaseService.rpc('ediel_prepare_customer_masterdata_v1', { p_company_id: company, p_customer_id: customerId, p_actor_user_id: actor, p_as_of: asOf, p_environment: 'test' })
  expect(error).toBeNull()
  return data as Record<string, unknown>
}
const declarations = (customerId: string) => sql<Array<{ id: string; validFrom: string; validTo: string | null; revoked: boolean; street: string; kind: string }>>(
  `SELECT coalesce(jsonb_agg(jsonb_build_object('id',d.id,'validFrom',d.valid_from,'validTo',d.valid_to,'revoked',EXISTS(SELECT FROM gridex_customer_masterdata.revocations r WHERE r.declaration_id=d.id),
   'street',d.end_user_masterdata#>>'{streetParts,0}','kind',convert_from(d.source_original,'UTF8')::jsonb#>>'{provenance,kind}') ORDER BY d.approved_at,d.valid_from),'[]')
   FROM gridex_customer_masterdata.signed_declarations d WHERE d.customer_id=${literal(customerId)}`)

beforeAll(async () => {
  sql(`INSERT INTO public.companies(id,name,status) VALUES(${literal(companyA)},'Synthetic F51 tenant A','active'),(${literal(companyB)},'Synthetic F51 tenant B','active');`)
  actorA = (await createBilateralSourceOperator(companyA, ['communication.read', 'communication.write', 'customers.read', 'customers.write'])).id
  actorB = (await createBilateralSourceOperator(companyB, ['communication.read', 'communication.write', 'customers.read', 'customers.write'])).id
})

describe('contract customer masterdata declaration (F51)', () => {
  it('website-signed contract: the signed section authorizes a future Z03, and a later address supersedes it from the change day', async () => {
    const customerId = customer(companyA, { name: 'Anna Webbkund', personal: '199001011234' })
    await recordRegisteredAddress({ companyId: companyA, customerId, address: { street: 'Storgatan 1', street2: 'lgh 1102', postalCode: '44130', city: 'Alingsås' }, source: 'website_declaration', actorUserId: null, declaredAt: pdfBase.signedAt, reference: 'APP-F51' })
    // The website signs with the section the shared database builder returns.
    const section = (await loadContractCustomerMasterdataSection({ companyId: companyA, customerId }))!
    expect(section).toMatchObject({ schema: 'gridex_contract_customer_masterdata_v1', customerId, source: 'website_declaration', declaredAt: pdfBase.signedAt,
      customerIdentity: { id: '199001011234', qualifier: 'SE2', agency: '260' },
      endUserMasterdata: { nameParts: ['Anna Webbkund'], streetParts: ['Storgatan 1', 'lgh 1102'], postalCode: '441 30', city: 'Alingsås', country: 'SE' } })
    // Exactly the rule's own projection of the same registered address (today's Z01 path).
    const today = await prepare(companyA, customerId, new Date().toISOString())
    expect(today).toMatchObject({ status: 'authorized', sourceKind: 'registered_customer_address', customerIdentity: section.customerIdentity, endUserMasterdata: section.endUserMasterdata })
    // The PDF lines the customer sees are the lines the owner requires (TS renderer = SQL list).
    expect(sql(`SELECT to_jsonb(gridex_customer_masterdata.contract_pdf_lines_v1(${literal(section.customerIdentity)}::jsonb,${literal(section.endUserMasterdata)}::jsonb))`)).toEqual(customerMasterdataPdfLines(section))

    const contract = await signedContract({ company: companyA, customer: customerId, signature: websiteSignature(customerId, section), pdf: buildAgreementPdfBuffer({ ...pdfBase, customerMasterdata: section }) })
    const before = stockholmDay(7), change = stockholmDay(10), after = stockholmDay(20)
    expect(await prepare(companyA, customerId, marketStart(before))).toMatchObject({ status: 'held' })
    expect(await deriveContractCustomerMasterdata({ companyId: companyA, contractId: contract.id, actorUserId: actorA, environment: 'test' })).toMatchObject({ status: 'derived' })
    expect(await prepare(companyA, customerId, marketStart(before))).toMatchObject({ status: 'authorized', sourceKind: 'signed_contract_masterdata',
      customerIdentity: section.customerIdentity, endUserMasterdata: section.endUserMasterdata })
    expect(await deriveContractCustomerMasterdata({ companyId: companyA, contractId: contract.id, actorUserId: actorA, environment: 'test' })).toMatchObject({ status: 'unchanged' })
    expect(declarations(customerId)).toHaveLength(1)

    // The customer moves; staff record the new address from the change day.
    await recordRegisteredAddress({ companyId: companyA, customerId, address: { street: 'Nygatan 3', postalCode: '44131', city: 'Alingsås' }, source: 'staff_entry', actorUserId: actorA, reference: 'card', now: new Date(`${change}T10:00:00Z`) })
    expect(await deriveContractCustomerMasterdata({ companyId: companyA, contractId: contract.id, actorUserId: actorA, environment: 'test' })).toMatchObject({ status: 'superseded' })
    expect(await prepare(companyA, customerId, marketStart(before))).toMatchObject({ status: 'authorized', sourceKind: 'signed_contract_masterdata', endUserMasterdata: section.endUserMasterdata })
    for (const day of [change, after]) expect(await prepare(companyA, customerId, marketStart(day))).toMatchObject({ status: 'authorized', sourceKind: 'signed_contract_masterdata',
      customerIdentity: section.customerIdentity, endUserMasterdata: { nameParts: ['Anna Webbkund'], streetParts: ['Nygatan 3'], postalCode: '441 31', city: 'Alingsås', country: 'SE' } })
    // History: the signed declaration is kept and revoked, re-issued up to the change day, and the new one starts there.
    const history = declarations(customerId)
    expect(history.map(d => [d.kind, d.street, d.revoked, d.validTo === null])).toEqual([
      ['signed_agreement', 'Storgatan 1', true, true], ['signed_agreement', 'Storgatan 1', false, false], ['registered_address_change', 'Nygatan 3', false, true]])
    expect(Date.parse(history[1].validTo!)).toBe(Date.parse(marketStart(change)))
    expect(Date.parse(history[2].validFrom)).toBe(Date.parse(marketStart(change)))
    expect(await deriveContractCustomerMasterdata({ companyId: companyA, contractId: contract.id, actorUserId: actorA, environment: 'test' })).toMatchObject({ status: 'unchanged' })
  })

  it('manual-intake contract: the staff member\'s registered address entry is the declaration', async () => {
    const customerId = customer(companyA, { name: 'Bertil Pappersavtal', personal: '198502023456' })
    await recordRegisteredAddress({ companyId: companyA, customerId, address: { street: 'Kyrkvägen 7', postalCode: '12345', city: 'Teststad' }, source: 'staff_entry', actorUserId: actorA, reference: 'intake-F51' })
    const contract = await signedContract({ company: companyA, customer: customerId, signature: tokenSignature(customerId), pdf: buildAgreementPdfBuffer(pdfBase) })
    expect(await deriveContractCustomerMasterdata({ companyId: companyA, contractId: contract.id, actorUserId: actorA, environment: 'test' })).toMatchObject({ status: 'derived' })
    expect(await prepare(companyA, customerId, marketStart(stockholmDay(14)))).toMatchObject({ status: 'authorized', sourceKind: 'signed_contract_masterdata',
      customerIdentity: { id: '198502023456', qualifier: 'SE2', agency: '260' },
      endUserMasterdata: { nameParts: ['Bertil Pappersavtal'], streetParts: ['Kyrkvägen 7'], postalCode: '123 45', city: 'Teststad', country: 'SE' } })
    const provenance = sql<Record<string, unknown>>(`SELECT convert_from(source_original,'UTF8')::jsonb->'provenance' FROM gridex_customer_masterdata.signed_declarations WHERE customer_id=${literal(customerId)}`)
    expect(provenance).toMatchObject({ kind: 'staff_entry', registeredAddressSource: 'staff_entry', declaredBy: actorA, enteredBy: actorA, sourceReference: 'intake-F51' })
    expect(sql(`SELECT jsonb_build_object('contract',contract_id,'agreement',agreement_sha256,'bytes',encode(sha256(agreement_original),'hex')) FROM gridex_customer_masterdata.signed_declarations WHERE customer_id=${literal(customerId)}`))
      .toEqual({ contract: contract.id, agreement: contract.hash, bytes: contract.hash })
  })

  it('stays held without a qualified registered address or when the signed bytes lack the signed section', async () => {
    const future = marketStart(stockholmDay(14))
    const missing = customer(companyA, { name: 'Cecilia Utanadress', personal: '197003034567' })
    const missingContract = await signedContract({ company: companyA, customer: missing, signature: tokenSignature(missing), pdf: buildAgreementPdfBuffer(pdfBase) })
    expect(await deriveContractCustomerMasterdata({ companyId: companyA, contractId: missingContract.id, actorUserId: actorA, environment: 'test' })).toEqual({ status: 'held', missing: ['staff_entry_registered_customer_address'] })
    expect(await prepare(companyA, missing, future)).toEqual({ status: 'held', missing: ['source_qualified_customer_identity_registered_address_at_requested_time'] })

    // A website declaration that the customer never signed (v2 snapshot, no section) is not a declaration.
    const unsigned = customer(companyA, { name: 'David Osignerad', personal: '196004045678' })
    await recordRegisteredAddress({ companyId: companyA, customerId: unsigned, address: { street: 'Ågatan 2', postalCode: '54321', city: 'Ort' }, source: 'website_declaration', actorUserId: null })
    const unsignedContract = await signedContract({ company: companyA, customer: unsigned, signature: websiteSignature(unsigned, null), pdf: buildAgreementPdfBuffer(pdfBase) })
    expect(await deriveContractCustomerMasterdata({ companyId: companyA, contractId: unsignedContract.id, actorUserId: actorA, environment: 'test' })).toEqual({ status: 'held', missing: ['staff_entry_registered_customer_address'] })

    // A section in the snapshot whose lines are not in the signed PDF bytes.
    const mismatch = customer(companyA, { name: 'Eva Annanpdf', personal: '195005056789' })
    await recordRegisteredAddress({ companyId: companyA, customerId: mismatch, address: { street: 'Torget 1', postalCode: '11122', city: 'Stad' }, source: 'website_declaration', actorUserId: null })
    const section = (await loadContractCustomerMasterdataSection({ companyId: companyA, customerId: mismatch }))!
    const mismatchContract = await signedContract({ company: companyA, customer: mismatch, signature: websiteSignature(mismatch, section), pdf: buildAgreementPdfBuffer(pdfBase) })
    expect(await deriveContractCustomerMasterdata({ companyId: companyA, contractId: mismatchContract.id, actorUserId: actorA, environment: 'test' })).toEqual({ status: 'held', missing: ['signed_agreement_customer_details_in_signed_original'] })
    // Bytes that are not the archived signed original.
    const forged = await supabaseService.rpc('ediel_derive_contract_customer_masterdata_v1', { p_company_id: companyA, p_contract_id: mismatchContract.id, p_actor_user_id: actorA, p_environment: 'test',
      p_agreement_original: `\\x${buildAgreementPdfBuffer({ ...pdfBase, customerMasterdata: section }).toString('hex')}` })
    expect(forged.error).toBeNull(); expect(forged.data).toEqual({ status: 'held', missing: ['archived_verified_signed_agreement_original'] })
    for (const customerId of [missing, unsigned, mismatch]) expect(declarations(customerId)).toEqual([])
  })

  it('refuses another tenant\'s customer and contract', async () => {
    const foreign = customer(companyB, { name: 'Fredrik Annantenant', personal: '194006067890' })
    await recordRegisteredAddress({ companyId: companyB, customerId: foreign, address: { street: 'Främmandevägen 9', postalCode: '99999', city: 'Bortastad' }, source: 'staff_entry', actorUserId: actorB })
    const foreignContract = await signedContract({ company: companyB, customer: foreign, signature: tokenSignature(foreign), pdf: buildAgreementPdfBuffer(pdfBase) })
    // Tenant A's actor naming B's contract under A: no such signed contract in A.
    expect(await deriveContractCustomerMasterdata({ companyId: companyA, contractId: foreignContract.id, actorUserId: actorA, environment: 'test' })).toEqual({ status: 'held', missing: ['archived_verified_signed_agreement_original'] })
    const direct = await supabaseService.rpc('ediel_derive_contract_customer_masterdata_v1', { p_company_id: companyA, p_contract_id: foreignContract.id, p_actor_user_id: actorA, p_environment: 'test', p_agreement_original: '\\x00' })
    expect(direct.data).toEqual({ status: 'held', missing: ['current_signed_customer_agreement'] })
    // Tenant A's actor naming tenant B: not a member, refused.
    const crossActor = await supabaseService.rpc('ediel_derive_contract_customer_masterdata_v1', { p_company_id: companyB, p_contract_id: foreignContract.id, p_actor_user_id: actorA, p_environment: 'test', p_agreement_original: '\\x00' })
    expect(crossActor.error?.code).toBe('42501')
    // Neither the section builder nor the rule lends B's customer to A.
    expect((await supabaseService.rpc('gridex_contract_customer_masterdata_section_v1', { p_company_id: companyA, p_customer_id: foreign })).data).toBeNull()
    expect(declarations(foreign)).toEqual([])
    // B's own actor derives B's declaration in B.
    expect(await deriveContractCustomerMasterdata({ companyId: companyB, contractId: foreignContract.id, actorUserId: actorB, environment: 'test' })).toMatchObject({ status: 'derived' })
    expect(await prepare(companyB, foreign, marketStart(stockholmDay(14)), actorB)).toMatchObject({ status: 'authorized', companyId: companyB, sourceKind: 'signed_contract_masterdata' })
  })

  it('is service-role only, and token signing binds the same section', () => {
    expect(sql(`SELECT to_jsonb(bool_and(NOT has_function_privilege(role_name,fn,'EXECUTE')))
      FROM unnest(ARRAY['anon','authenticated']) role_name CROSS JOIN unnest(ARRAY['public.ediel_derive_contract_customer_masterdata_v1(uuid,uuid,uuid,text,bytea)','public.gridex_contract_customer_masterdata_section_v1(uuid,uuid)']) fn`)).toBe(true)
    expect(sql(`SELECT to_jsonb(bool_and(has_function_privilege('service_role',fn,'EXECUTE'))) FROM unnest(ARRAY['public.ediel_derive_contract_customer_masterdata_v1(uuid,uuid,uuid,text,bytea)','public.gridex_contract_customer_masterdata_section_v1(uuid,uuid)']) fn`)).toBe(true)
    expect(sql(`SELECT to_jsonb(position('gridex_customer_masterdata.contract_section_v1(v_contract.company_id,v_contract.customer_id)' IN prosrc)>0 AND position('gridex_online_contract_signature_v2' IN prosrc)>0)
      FROM pg_proc WHERE oid='public.gridex_finalize_customer_contract_signature_v1(text,text,text)'::regprocedure`)).toBe(true)
  })
})
