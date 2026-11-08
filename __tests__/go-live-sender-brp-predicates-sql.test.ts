import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

// canonical105: QA01.04 readiness subchain; not a full release/publication PASS.
// In-memory SQL only: actual canonical table DDL, route resolver and readiness view.
// No transport, service credentials, production activation, or helper replacements.
const schema = readFileSync('supabase/schema.sql', 'utf8')
const migration = readFileSync('supabase/migrations/20261106200556_harden_go_live_sender_brp_predicates.sql', 'utf8')
const company = '07908000-0000-4000-8000-000000000001'
const other = '07908000-0000-4000-8000-000000000002'
const plan = '07908000-0000-4000-8000-000000000003'
let db: PGlite
function definition(kind: string, name: string) {
  const start = schema.indexOf(`CREATE ${kind} public.${name}`)
  if (start < 0) throw new Error(`Missing canonical ${kind} ${name}`)
  return schema.slice(start, schema.indexOf('\n--\n', start)).trim()
}
async function readiness() {
  const result = await db.query<Record<string, unknown>>('select * from public.platform_go_live_readiness_v where company_id = $1', [company])
  expect(result.rows).toHaveLength(1)
  return result.rows[0]
}
beforeAll(async () => {
  db = new PGlite()
  await db.exec(definition('TYPE', 'ediel_environment_type'))
  for (const name of ['gridex_normalize_org_number', 'gridex_new_external_tenant_reference'])
    await db.exec(definition('FUNCTION', name + '('))
  for (const name of ['companies', 'ediel_actor_settings', 'ediel_brp_settings', 'ediel_route_profiles', 'ediel_mailboxes', 'legal_text_versions', 'price_plans', 'price_plan_versions', 'company_email_settings'])
    await db.exec(definition('TABLE', name + ' ('))
  for (const name of ['contract_products', 'contract_product_versions', 'contract_offers', 'tenant_contract_assignments', 'tenant_contract_channels', 'tenant_legal_profiles', 'legal_templates', 'legal_template_versions', 'tenant_legal_overrides', 'legal_requirement_rules', 'price_books', 'legal_bundle_versions', 'legal_bundle_version_documents'])
    await db.exec(definition('TABLE', name + ' ('))
  for (const name of ['gridex_luhn_valid', 'gridex_address_complete', 'gridex_jsonb_valid_email', 'gridex_jsonb_valid_phone', 'gridex_contact_address', 'gridex_legal_contact_complete', 'gridex_billing_information_complete', 'gridex_dispute_information_complete', 'gridex_tenant_legal_profile_missing_fields', 'gridex_refresh_legal_profile_completeness', 'gridex_render_address', 'gridex_render_billing_information', 'gridex_render_dispute_resolution', 'gridex_render_legal_document', 'gridex_contract_readiness_blocker_v2'])
    await db.exec(definition('FUNCTION', name + '('))
  await db.exec(definition('FUNCTION', 'gridex_required_legal_modules(p_customer_type text, p_contract_type text, p_channel text, p_automatic_renewal boolean, p_requires_power_of_attorney boolean, p_production_enabled boolean)'))
  await db.exec(definition('FUNCTION', 'gridex_validate_contract_readiness_v2('))
  const trigger = schema.match(/CREATE TRIGGER [^\n]* ON public\.tenant_legal_profiles[^\n]*gridex_refresh_legal_profile_completeness\(\);/)
  if (!trigger) throw new Error('Missing canonical legal completeness trigger')
  await db.exec(trigger[0])
  await db.exec(definition('FUNCTION', 'gridex_resolve_ediel_route_for_process('))
  await db.exec(definition('VIEW', 'platform_go_live_readiness_v '))
  await db.exec('create role readiness_reader; grant select on public.platform_go_live_readiness_v to readiness_reader')
  await db.exec(migration)
  await db.exec(migration) // Forward application is repeatable and preserves existing grants.
}, 30_000)
afterAll(async () => { await db?.close() })
beforeEach(async () => {
  await db.exec('begin')
  await db.query('insert into public.companies(id,name) values ($1, $3), ($2, $4)', [company, other, 'Synthetic predicate tenant', 'Isolation control tenant'])
  await db.query(`insert into public.company_email_settings(company_id,verification_status,sender_mode,sender_email) values ($1,'verified','verified_domain','sender@example.invalid')`, [company])
  await db.query(`insert into public.ediel_brp_settings(company_id,environment,brp_ediel_id,brp_name) values ($1,'production','SYNTHETIC-BRP','Synthetic BRP')`, [company])
})
afterEach(async () => { await db.exec('rollback') })

async function seedOperational() {
    await db.query(`insert into public.ediel_actor_settings(company_id,actor_name,actor_ediel_id,environment) values ($1,'Synthetic actor','SYNTHETIC-ACTOR','production')`, [company])
    for (const family of ['PRODAT', 'UTILTS'])
      await db.query(`insert into public.ediel_route_profiles(company_id,environment,message_family,application_reference,receiver_source) values ($1,'production',$2,$2,'selected_metering_point_grid_owner')`, [company, family])
    await db.exec("insert into public.ediel_mailboxes(environment,mailbox_name,email_address) values ('production','Synthetic isolated shared mailbox','mailbox@example.invalid')")
    for (const type of ['terms', 'privacy_policy', 'withdrawal', 'power_of_attorney', 'price_terms'])
      await db.query(`insert into public.legal_text_versions(company_id,type,version,title,body,status,published_at) values ($1,$2,'1','Synthetic legal document','Synthetic isolated legal terms with explicit consent and pricing.','published',now())`, [company, type])
    const snapshot = JSON.stringify({ pricing_model: 'fixed', currency: 'SEK', price_areas: ['SE1'], fixed_price_sek_kwh: 1.25, invoice_fee_sek: 0, vat_rate: 0.25 })
    await db.query(`insert into public.price_plans(id,company_id,name,pricing_model,status,plan_code) values ($1,$2,'Synthetic fixed plan','fixed','published','SYNTHETIC-FIXED')`, [plan, company])
    await db.query(`insert into public.price_plan_versions(company_id,price_plan_id,version_number,status,snapshot_json,content_sha256,published_at,locked_at) values ($1,$2,1,'published',$3::jsonb,$4,now(),now())`, [company, plan, snapshot, createHash('sha256').update(snapshot).digest('hex')])
}
describe('production sender and BRP readiness predicates', () => {
  it('accepts an active verified sender and nonblank same-tenant production BRP', async () => {
    expect(await readiness()).toMatchObject({ has_sender_identity: true, has_brp: true })
  })
  it('rejects inactive sender even when verification remains verified', async () => {
    await db.exec('update public.company_email_settings set is_active = false')
    expect((await readiness()).has_sender_identity).toBe(false)
  })
  it('rejects disabled sender mode even when verification remains verified', async () => {
    await db.exec("update public.company_email_settings set sender_mode = 'disabled'")
    expect((await readiness()).has_sender_identity).toBe(false)
  })
  it.each(['not_started', 'pending_dns', 'failed', 'disabled'])('rejects unaccepted sender verification %s', async (status) => {
    await db.query('update public.company_email_settings set verification_status = $1', [status])
    expect((await readiness()).has_sender_identity).toBe(false)
  })
  it('preserves the accepted verification condition for existing fallback mode', async () => {
    await db.exec("update public.company_email_settings set sender_mode = 'fallback_platform_sender', fallback_allowed = false")
    expect((await readiness()).has_sender_identity).toBe(true)
  })
  it.each(['', '   '])('rejects blank production BRP %j', async (id) => {
    await db.query('update public.ediel_brp_settings set brp_ediel_id = $1', [id])
    expect((await readiness()).has_brp).toBe(false)
  })
  it('accepts nonblank BRP with surrounding spaces without broadening BRP lifecycle policy', async () => {
    await db.exec("update public.ediel_brp_settings set brp_ediel_id = ' SYNTHETIC-BRP ', is_active = false, valid_to = '2000-01-01'")
    expect((await readiness()).has_brp).toBe(true)
  })
  it('does not borrow a verified sender or BRP from another tenant', async () => {
    await db.query('update public.company_email_settings set company_id = $1', [other])
    await db.query('update public.ediel_brp_settings set company_id = $1', [other])
    expect(await readiness()).toMatchObject({ has_sender_identity: false, has_brp: false })
  })
  it('does not count a test-environment BRP as production', async () => {
    await db.exec("update public.ediel_brp_settings set environment = 'test'")
    expect((await readiness()).has_brp).toBe(false)
  })
  it('rejects missing rows', async () => {
    await db.exec('delete from public.company_email_settings; delete from public.ediel_brp_settings')
    expect(await readiness()).toMatchObject({ has_sender_identity: false, has_brp: false })
  })
  it('uses EXISTS semantics when unusable rows coexist with valid rows', async () => {
    await db.query(`insert into public.ediel_brp_settings(company_id,environment,brp_ediel_id,brp_name,is_default) values ($1,'production','','Blank default',true)`, [company])
    expect((await readiness()).has_brp).toBe(true)
  })
  it('preserves security_invoker and existing view SELECT grants', async () => {
    const r = await db.query<{ reloptions: string[], allowed: boolean }>(`select reloptions, has_table_privilege('readiness_reader',oid,'SELECT') as allowed from pg_class where oid='public.platform_go_live_readiness_v'::regclass`)
    expect(r.rows[0]).toMatchObject({ reloptions: ['security_invoker=true'], allowed: true })
  })
  it('evaluates genuine synthetic legal, price and route rows without activating production', async () => {
    await seedOperational()
    const row = await readiness()
    for (const [key, value] of Object.entries(row)) if (key.startsWith('has_')) expect(value, key).toBe(true)
    expect(row.prodat_route_decision).toMatchObject({ status: 'ready', blockers: [], senderEdielId: 'SYNTHETIC-ACTOR' })
    const activation = await db.query('select live_ediel_enabled, ediel_production_enabled, ediel_production_status from public.companies where id=$1', [company])
    expect(activation.rows[0]).toEqual({ live_ediel_enabled: false, ediel_production_enabled: false, ediel_production_status: 'not_ready' })
  })
})

const product = '07908000-0000-4000-8000-000000000004'
const version = '07908000-0000-4000-8000-000000000005'
const offer = '07908000-0000-4000-8000-000000000006'
const assignment = '07908000-0000-4000-8000-000000000007'
const book = '07908000-0000-4000-8000-000000000008'
async function publicationReadiness(tenant = company) {
  const r = await db.query<{ result: { can_execute: boolean, blockers: { code: string }[] } }>(
    "select public.gridex_validate_contract_readiness_v2($1,$2,'publish_version','internal') as result", [tenant, offer])
  return r.rows[0].result
}
async function seedPublication() {
  await seedOperational()
  // Real completeness trigger derives verified from complete, reviewed synthetic fields.
  const profile = {
    legal_name: 'Synthetic Legal Supplier AB', organization_number: '9900000010',
    postal_address: { address_line_1: 'Synthetic Street 1', postal_code: '123 45', city: 'Teststad', country_code: 'SE' },
    customer_service_email: 'support@example.invalid', phone: '0000000000', website: 'https://example.invalid',
    complaints_contact: { email: 'complaints@example.invalid' }, data_protection_contact: { email: 'privacy@example.invalid' },
    billing_information: { email: 'billing@example.invalid' },
    dispute_resolution_information: { authority: 'Synthetic dispute authority', url: 'https://example.invalid/disputes' },
    source_company_snapshot: { legal_name_source: 'tenant_explicit' }, reviewed_at: '2026-01-01T00:00:00Z', review_required: false,
  }
  await db.query(`insert into public.tenant_legal_profiles(company_id,legal_name,organization_number,postal_address,customer_service_email,phone,website,complaints_contact,data_protection_contact,billing_information,dispute_resolution_information,source_company_snapshot,reviewed_at,review_required)
    select $1,p.legal_name,p.organization_number,p.postal_address,p.customer_service_email,p.phone,p.website,p.complaints_contact,p.data_protection_contact,p.billing_information,p.dispute_resolution_information,p.source_company_snapshot,p.reviewed_at,p.review_required
    from jsonb_populate_record(null::public.tenant_legal_profiles,$2::jsonb) p`, [company, JSON.stringify(profile)])
  const completeness = await db.query('select completeness_status,missing_fields from public.tenant_legal_profiles where company_id=$1', [company])
  expect(completeness.rows[0]).toEqual({ completeness_status: 'verified', missing_fields: [] })
  const snapshot = JSON.stringify({ interval_resolution: 'fixed', energy_direction: 'consumption', production: { enabled: false }, price_areas: ['SE1'], base_components: [{ source_type: 'fixed', price_area: 'SE1', fixed_price_sek_per_kwh: 1.25 }], invoice_fee_sek: 0, vat_rate: 0.25 })
  const hash = createHash('sha256').update(snapshot).digest('hex')
  await db.query(`update public.price_plan_versions set snapshot_json=$1::jsonb, content_sha256=$2`, [snapshot, hash])
  const pv = await db.query<{ id: string }>('select id from public.price_plan_versions where company_id=$1', [company])
  await db.query(`insert into public.price_books(id,company_id,name,status,price_plan_id,price_plan_version_id,content_sha256,published_at,locked_at) values ($1,$2,'Synthetic fixed price book','published',$3,$4,$5,now(),now())`, [book, company, plan, pv.rows[0].id, hash])
  await db.query(`insert into public.contract_products(id,company_id,product_code,name,product_category) values ($1,$2,'SYNTHETIC-FIXED','Synthetic fixed product','electricity')`, [product, company])
  await db.query(`insert into public.contract_product_versions(id,contract_product_id,version_number,customer_type,contract_type,pricing_model,price_plan_id,price_plan_version_id,price_areas,commercial_snapshot,content_sha256,status,locked_at,energy_direction) values ($1,$2,1,'private','fixed','fixed',$3,$4,ARRAY['SE1'],$5::jsonb,$6,'approved',now(),'consumption')`, [version, product, plan, pv.rows[0].id, snapshot, hash])
  await db.query(`insert into public.tenant_contract_assignments(id,company_id,contract_product_version_id) values ($1,$2,$3)`, [assignment, company, version])
  await db.query(`insert into public.tenant_contract_channels(assignment_id,channel,status) values ($1,'internal','active')`, [assignment])
  const modules = ['terms', 'privacy_policy', 'withdrawal', 'power_of_attorney', 'price_terms']
  await db.query(`insert into public.legal_requirement_rules(customer_type,contract_type,channel,required_module_keys) values ('private','fixed','website',$1::text[])`, [modules])
  for (const readinessModule of modules) {
    const template = await db.query<{ id: string }>(`insert into public.legal_templates(module_key,name,mandatory) values ($1,$2,true) returning id`, [readinessModule, 'Synthetic ' + readinessModule])
    const body = '{{legal_name}} ({{organization_number}}), {{company_address}}. Contact {{customer_service_email}}. Synthetic terms: fixed 1.25 SEK/kWh, zero invoice fee, 25% VAT. {{billing_information}} {{dispute_resolution_information}}'
    await db.query(`insert into public.legal_template_versions(legal_template_id,version_number,title,body,content_sha256,status,published_at,locked_at) values ($1,1,$2,$3,$4,'published',now(),now())`, [template.rows[0].id, 'Synthetic ' + readinessModule, body, createHash('sha256').update(body).digest('hex')])
  }
  await db.query(`insert into public.contract_offers(id,company_id,name,contract_type,customer_type,contract_product_id,contract_product_version_id,price_plan_id,price_plan_version_id,price_book_id,commercial_snapshot,invoice_fee_sek,vat_rate) values ($1,$2,'Synthetic publication candidate','fixed','private',$3,$4,$5,$6,$7,$8::jsonb,0,0.25)`, [offer, company, product, version, plan, pv.rows[0].id, book, snapshot])
}

describe('actual publication-readiness consumer with genuine synthetic dependencies', () => {
  it('accepts a complete synthetic publication candidate through the real validator', async () => {
    await seedPublication()
    expect(await publicationReadiness()).toMatchObject({ can_execute: true, blockers: [] })
  })
  it.each([
    "update public.company_email_settings set is_active=false",
    "update public.company_email_settings set sender_mode='disabled'",
    "update public.ediel_brp_settings set brp_ediel_id=''",
    "update public.ediel_brp_settings set brp_ediel_id='   '",
  ])('blocks the real consumer when %s', async (sql) => {
    await seedPublication()
    expect(await publicationReadiness()).toMatchObject({ can_execute: true, blockers: [] })
    await db.exec(sql)
    expect(await publicationReadiness()).toMatchObject({ can_execute: false, blockers: [{ code: 'tenant_go_live_not_ready' }] })
  })
  it('does not borrow another tenant offer', async () => {
    await seedPublication()
    expect(await publicationReadiness(other)).toMatchObject({ can_execute: false, blockers: [{ code: 'contract_offer_not_found' }] })
  })
  it('retains real legal completeness rejection', async () => {
    await seedPublication()
    await db.exec("update public.tenant_legal_profiles set customer_service_email='invalid'")
    const result = await publicationReadiness()
    expect(result.can_execute).toBe(false)
    expect(result.blockers.map(b => b.code)).toContain('tenant_legal_profile_not_ready')
  })
  it('retains unresolved legal variable rejection', async () => {
    await seedPublication()
    await db.exec("update public.legal_template_versions set body='{{unresolved_synthetic_variable}}'")
    const result = await publicationReadiness()
    expect(result.can_execute).toBe(false)
    expect(result.blockers.map(b => b.code)).toContain('unresolved_legal_variables')
  })
  it('retains genuine fixed-price component rejection', async () => {
    await seedPublication()
    await db.exec("update public.contract_offers set commercial_snapshot = jsonb_set(commercial_snapshot,'{base_components}','[]'::jsonb)")
    const result = await publicationReadiness()
    expect(result.can_execute).toBe(false)
    expect(result.blockers.map(b => b.code)).toContain('fixed_price_area_missing')
  })
})
