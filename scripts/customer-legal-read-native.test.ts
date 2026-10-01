import { createHash, randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { assertLowRoleReadDenied, proofReference, proofSql, quote, readFixture, saveFixture, seedReadActors, type ReadProofFixture } from './customer-read-proof-native'

const env = 'GRIDEX_LEGAL_READ_FIXTURE_PATH'
const table = 'customer_legal_acceptances'
function legalSourceSnapshot(companies: string[]) {
  const filter = companies.map(quote).join(',')
  return createHash('sha256').update(JSON.stringify(proofSql(`SELECT jsonb_build_object(
    'acceptances',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.customer_legal_acceptances t WHERE company_id IN (${filter})),
    'products',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.contract_products t WHERE company_id IN (${filter})),
    'versions',(SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM public.contract_product_versions t JOIN public.contract_products p ON p.id=t.contract_product_id WHERE p.company_id IN (${filter})),
    'bundles',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.legal_bundle_versions t WHERE company_id IN (${filter})),
    'documents',(SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM public.legal_bundle_version_documents t JOIN public.legal_bundle_versions b ON b.id=t.legal_bundle_version_id WHERE b.company_id IN (${filter})),
    'legacy',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.legal_text_versions t WHERE company_id IN (${filter}))
  );`))).digest('hex')
}
it('seeds valid canonical and legacy legal relations and postchecks real HTTP source immutability', async () => {
  if (process.env.GRIDEX_LEGAL_READ_VERIFY_AFTER_HTTP === '1') {
    const f = readFixture<ReadProofFixture>(env)
    expect(legalSourceSnapshot(f.companies)).toBe(f.sourceHash)
    for (const c of f.customers) expect(proofSql<number>(`SELECT to_jsonb(count(*)) FROM public.customer_portal_api_access_logs
      WHERE company_id=${quote(c.companyId)} AND customer_id=${quote(c.customerId)} AND route='/api/v1/customer/legal-acceptances'
      AND action='read_legal_acceptances_page';`)).toBeGreaterThan(0)
    console.log('LEGAL_READ_HTTP_POST_NATIVE_PASS source_rows_unchanged=true customers=3')
    return
  }
  const f = await seedReadActors('legal-read', '/api/v1/customer/legal-acceptances', ['customer_legal.read'])
  const docs = new Map<string, { bundle: string; document: string; legacy: string; hash: string }>()
  for (const companyId of f.companies) {
    const product = randomUUID(), version = randomUUID(), bundle = randomUUID(), document = randomUUID(), legacy = randomUUID()
    const snapshot = quote(JSON.stringify({ contract_type: 'variable_hourly', energy_direction: 'consumption', synthetic_company_proof: companyId }))
    const body = 'Synthetic immutable terms', hash = createHash('sha256').update(body).digest('hex')
    proofSql(`INSERT INTO public.contract_products(id,company_id,product_code,name,product_category,energy_direction)
      VALUES(${quote(product)},${quote(companyId)},${quote(`synthetic-legal-${product}`)},'Synthetic legal read product','electricity','consumption');
      INSERT INTO public.contract_product_versions(id,contract_product_id,version_number,customer_type,contract_type,pricing_model,commercial_snapshot,content_sha256,energy_direction,status,approved_at,locked_at)
      VALUES(${quote(version)},${quote(product)},1,'private','variable_hourly','spot_hourly',${snapshot}::jsonb,
        encode(extensions.digest((${snapshot}::jsonb)::text,'sha256'),'hex'),'consumption','approved',now(),now());
      INSERT INTO public.legal_bundle_versions(id,company_id,contract_product_version_id,version_number,legal_mode,rendered_snapshot,content_sha256)
      VALUES(${quote(bundle)},${quote(companyId)},${quote(version)},1,'ops_standard',${snapshot}::jsonb,
        encode(extensions.digest((${snapshot}::jsonb)::text,'sha256'),'hex'));
      INSERT INTO public.legal_bundle_version_documents(id,legal_bundle_version_id,module_key,title,rendered_body,content_sha256,template_version)
      VALUES(${quote(document)},${quote(bundle)},'terms','Synthetic terms',${quote(body)},${quote(hash)},'synthetic-1');
      UPDATE public.legal_bundle_versions SET status='published',published_at=now(),locked_at=now() WHERE id=${quote(bundle)};
      INSERT INTO public.legal_text_versions(id,company_id,type,version,title,body,status,published_at)
      VALUES(${quote(legacy)},${quote(companyId)},'terms','synthetic-1','Synthetic legacy terms','Synthetic legacy content','published',now());
      SELECT to_jsonb(count(*)) FROM public.legal_bundle_version_documents WHERE id=${quote(document)};`)
    docs.set(companyId, { bundle, document, legacy, hash })
  }
  for (const c of f.customers) {
    const d = docs.get(c.companyId)!
    const count = c.tag === 'A1' ? 4 : 1
    for (let index = 0; index < count; index++) {
      const id = randomUUID(), accepted = index === 0 ? '2026-09-30 12:00:00+00' : index < 3 ? '2026-09-30 10:00:00.123456+00' : '2026-09-30 09:00:00+00'
      const exact = index < 2, legacy = index === 2
      proofSql(`INSERT INTO public.customer_legal_acceptances(id,company_id,customer_id,acceptance_type,legal_bundle_version_document_id,
        legal_text_version_id,legal_module_key,legal_document_version,legal_document_sha256,accepted_at,source,snapshot,metadata,created_at)
        VALUES(${quote(id)},${quote(c.companyId)},${quote(c.customerId)},'terms',${exact ? quote(d.document) : 'NULL'},${legacy ? quote(d.legacy) : 'NULL'},
          ${exact ? "'terms'" : 'NULL'},${exact ? "'synthetic-1'" : 'NULL'},${exact ? quote(d.hash) : 'NULL'},${quote(accepted)},'customer_portal',
          '{"internal":"must not project"}','{"private":"must not project"}',${quote(accepted)}); SELECT to_jsonb(count(*)) FROM public.customer_legal_acceptances WHERE id=${quote(id)};`)
    }
    const rows = proofSql<Array<Record<string, unknown>>>(`SELECT jsonb_agg(to_jsonb(t) ORDER BY accepted_at DESC,id DESC)
      FROM public.customer_legal_acceptances t WHERE company_id=${quote(c.companyId)} AND customer_id=${quote(c.customerId)};`)
    expect(rows).toHaveLength(count)
    c.expected = rows.map(row => ({ acceptance_reference: proofReference('acceptance', c.companyId, String(row.id)), acceptance_type: 'terms',
      document_reference: row.legal_bundle_version_document_id ? proofReference('legal_document', c.companyId, d.document)
        : row.legal_text_version_id ? proofReference('legal_document', c.companyId, d.legacy) : null,
      document_code: row.legal_module_key, document_version: row.legal_document_version, document_hash: row.legal_document_sha256,
      accepted_at: row.accepted_at, source: 'customer_portal', created_at: row.created_at }))
    assertLowRoleReadDenied(table, c)
  }
  expect(f.customers[0].expected[1].accepted_at).toEqual(f.customers[0].expected[2].accepted_at)
  f.sourceHash = legalSourceSnapshot(f.companies)
  saveFixture(env, f)
  console.log('LEGAL_READ_HTTP_SEED_NATIVE_PASS customers=3 bundle_chain=true legacy_chain=true microseconds=true direct_low_roles_denied=true')
})
