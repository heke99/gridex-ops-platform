// masterplan: IMP-05, AT-IMP-05
// Selected real PostgreSQL admission/route component, not native or whole-IMP05
// approval. PGlite, parser input, permission RPC and lock-only graph are finite
// ports; no SMTP delivery, ordinary reception, legal attribution or capture is
// fabricated. All authority/custody/endpoint/route functions come from source.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ownerSource } from './helpers/sourceOwnerFixtures'

type Row = Record<string, unknown>
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const company = id(2), actor = id(50), mailbox = id(800), mail = id(801), parse = id(802)
const routeId = id(810), profileId = id(811)
const smtp = 'configured@example.invalid'
const wire = ownerSource().raw_payload!.replace('NAD+DO+54321:160:SVK', 'NAD+DO+98765:160:SVK')
const hash = createHash('sha256').update(wire).digest('hex')
const schema = readFileSync('supabase/schema.sql', 'utf8')
const intake = readFileSync('supabase/migrations/20261005043923_ediel_unattributed_technical_intake.sql', 'utf8')
const forward = readFileSync('supabase/migrations/20261005130401_ediel_imp05_original_mailbox_return_route.sql', 'utf8')
const headerNegativeForward = readFileSync('supabase/migrations/20261010102349_ediel_assigned_prodat_header_negative_birth.sql', 'utf8')
// Exercise the real migration boundary even after the combined schema capture
// includes that migration. These two byte-exact source definitions match the
// admitted pre-forward main; the rest of the fixture uses the current schema.
const preForward = readFileSync('__tests__/fixtures/ediel-imp05-pre-forward-source-functions.sql', 'utf8')
const forwardFunctions = [
  ['gridex_ediel_technical_ack.select_configured_reply_route_v2(', 'gridex_ediel_technical_ack.select_configured_reply_route_v2(uuid,jsonb,text,text,text,integer)'],
  ['public.ediel_record_inbound_reception_v1(', 'public.ediel_record_inbound_reception_v1(uuid,uuid,uuid,uuid,uuid)'],
] as const
let db: PGlite

function definition(kind: 'TABLE' | 'FUNCTION' | 'TYPE', name: string, source = schema) {
  const start = source.indexOf(`CREATE ${kind} ${name}`)
  if (start < 0) throw Error(`Missing actual ${kind} ${name}`)
  if (kind !== 'FUNCTION') {
    const end = source.indexOf('\n);', start)
    if (end < 0) throw Error(`Missing actual definition end ${name}`)
    return source.slice(start, end + 3)
  }
  const match = /\bAS (\$[\w]*\$)/.exec(source.slice(start))
  if (!match) throw Error(`Missing actual function body ${name}`)
  const end = source.indexOf(`${match[1]};`, start + match.index + match[0].length)
  if (end < 0) throw Error(`Missing actual function end ${name}`)
  return source.slice(start, end + match[1].length + 1)
}
async function installForward() {
  await db.exec(forward)
  // Replay the later real selector upgrade after the IMP05 boundary. Its
  // exact pre/post guards and the full captured-body assertions remain active.
  const selectorUpgrades = [...headerNegativeForward.matchAll(/DO \$assigned_birth_upgrade\$[\s\S]*?END \$assigned_birth_upgrade\$;/g)]
    .filter(match => match[0].includes("target_oid:='gridex_ediel_technical_ack.select_configured_reply_route_v2(uuid,jsonb,text,text,text,integer)'::regprocedure;"))
  expect(selectorUpgrades).toHaveLength(1)
  await db.exec(selectorUpgrades[0][0])
  // The modeled predecessor must migrate to the actual captured current body.
  // A stale snapshot or a different production correction fails this binding.
  for (const [name, identity] of forwardFunctions) {
    const current = definition('FUNCTION', name)
    const marker = /\bAS (\$[\w]*\$)/.exec(current)!
    const body = current.slice(marker.index + marker[0].length, current.lastIndexOf(marker[1]))
    const actual = (await db.query<{ prosrc: string }>('select prosrc from pg_proc where oid=$1::regprocedure', [identity])).rows[0].prosrc
    expect(actual).toBe(body)
  }
}
async function rows(table: string) { return (await db.query<Row>(`select * from ${table}`)).rows }
async function service<T>(work: () => Promise<T>) {
  try { await db.exec('set role service_role'); return await work() }
  finally { await db.exec('reset role') }
}
async function route(source: string, c = company, a = actor, from = smtp) {
  return service(async () => (await db.query<{ value: Row }>(
    'select public.ediel_read_technical_syntax_ack_route_v1($1,$2,$3,$4,$5,$6) value',
    [c, a, source, from, 'smtp.example.invalid', 465])).rows[0].value)
}

beforeEach(async () => {
  db = new PGlite()
  await db.exec(`create role service_role; create role anon; create role authenticated;
    create schema extensions; create schema gridex_utilts_binding;
    create schema gridex_ediel_technical_ack; create schema gridex_ediel_retention;
    create schema gridex_negative_fixtures; create schema gridex_received_sources;
    create schema gridex_ediel_ack_replay; create schema gridex_ediel_inbound_receptions;
    create function extensions.digest(bytea,text) returns bytea language sql immutable as 'select sha256($1)';
    -- Finite permission port; actual actor/company/membership checks execute.
    create function public.gridex_actor_has_company_permission(uuid,uuid,text) returns boolean language sql as
      $$select $1='${actor}'::uuid and $2='${company}'::uuid and $3='communication.write'$$;`)
  for (const name of ['public.gridex_normalize_org_number(', 'public.gridex_new_external_tenant_reference(']) await db.exec(definition('FUNCTION', name))
  await db.exec(definition('TYPE', 'public.ediel_environment_type AS ENUM ('))
  for (const table of ['ediel_messages', 'inbound_email_messages', 'inbound_email_attachments', 'inbound_ediel_parse_results',
    'ediel_mailboxes', 'tenant_actor_identifiers', 'tenant_counterparty_relations', 'platform_actor_identifiers',
    'ediel_actor_settings', 'ediel_route_profiles', 'companies', 'company_memberships', 'user_profiles',
    'communication_routes', 'ediel_transport_profiles']) await db.exec(definition('TABLE', `public.${table} (`))
  // Install genuine empty private receipt readers used by current source guards.
  // These fixtures create no assigned negative birth or header authority.
  await db.exec('create schema gridex_ediel_header_negative_birth')
  await db.exec('create schema gridex_ediel_common_header')
  await db.exec(definition('TABLE', 'gridex_ediel_common_header.sources ('))
  await db.exec(definition('TABLE', 'gridex_ediel_header_negative_birth.receipts ('))
  for (const name of ['gridex_ediel_header_negative_birth.is_bound_v1(', 'gridex_ediel_header_negative_birth.evidence_v1(']) await db.exec(definition('FUNCTION', name))
  for (const name of ['wire_tokens_bounded_v1', 'closure_wire_tokens_v1', 'source_wire_point_v1']) await db.exec(definition('FUNCTION', `gridex_received_sources.${name}(`))
  for (const table of ['gridex_ediel_technical_ack.sources', 'gridex_ediel_technical_ack.replies',
    'gridex_ediel_technical_ack.syntax_facets', 'gridex_received_sources.validation_assessments',
    'gridex_received_sources.sources', 'gridex_ediel_retention.blob_tombstones',
    'gridex_ediel_inbound_receptions.receptions']) await db.exec(definition('TABLE', `${table} (`))
  for (const table of ['ediel_messages', 'inbound_email_messages', 'inbound_email_attachments', 'inbound_ediel_parse_results', 'ediel_mailboxes', 'companies', 'user_profiles']) {
    for (const match of schema.matchAll(new RegExp(`ALTER TABLE ONLY public\\.${table}\\n[\\s\\S]*?;`, 'g'))) {
      if (/ADD CONSTRAINT .* PRIMARY KEY \(/.test(match[0])) await db.exec(match[0])
    }
  }
  for (const name of ['gridex_ediel_retention.public_content_v1(', 'public.ediel_is_qualified_retention_transition_v1(',
    'gridex_utilts_binding.wire_tokens_v1(', 'gridex_ediel_technical_ack.envelope(', 'gridex_ediel_technical_ack.capture_source(',
    'gridex_ediel_technical_ack.read_endpoint_v1(', 'gridex_ediel_technical_ack.require_actor_v1(',
    'public.ediel_read_technical_source_endpoint_v2(', 'public.gridex_validate_ediel_message_contract(',
    'gridex_ediel_technical_ack.record_syntax_v1(', 'gridex_ediel_technical_ack.capture_reply_before_native_ack_guide_v1(',
    'gridex_ediel_technical_ack.require_source_v1(', 'gridex_ediel_technical_ack.require_current_endpoint_v1(',
    'gridex_negative_fixtures.assert_actor_v1(', 'gridex_negative_fixtures.assert_prepare_actor_v1(',
    'gridex_ediel_technical_ack.select_configured_reply_route_v2(', 'gridex_ediel_technical_ack.read_route_v1(',
    'public.ediel_read_technical_syntax_ack_route_v1(', 'public.ediel_record_technical_syntax_facet_v2(',
    'gridex_received_sources.capture_insert(',
    'gridex_received_sources.capture_utilts_insert_v1(', 'public.gridex_ediel_message_inbound_email_tenant_guard(',
    'public.ediel_record_inbound_reception_v1(']) await db.exec(definition('FUNCTION', name,
      forwardFunctions.some(([forwardName]) => forwardName === name) ? preForward : schema))
  // Lock-only finite graph: no authority/verdict/data returned. Actual endpoint
  // and actor functions still read and lock their real fixture tables. This
  // component does not qualify full graph concurrency or native isolation.
  await db.exec(`create function gridex_ediel_ack_replay.lock_current_graph_v2() returns void language plpgsql as $$begin
    lock table public.user_profiles,public.companies,public.company_memberships,public.tenant_actor_identifiers,
      public.tenant_counterparty_relations,public.platform_actor_identifiers in share mode; end$$;`)
  for (const trigger of ['ediel_messages_canonical_contract_biu', 'ediel_capture_technical_source',
    'gridex_capture_received_prodat_source', 'gridex_capture_received_utilts_source', 'trg_ediel_message_inbound_email_tenant_guard']) {
    const start = schema.indexOf(`CREATE TRIGGER ${trigger} `), end = schema.indexOf(';', start)
    if (start < 0 || end < 0) throw Error(`Missing actual trigger ${trigger}`)
    await db.exec(schema.slice(start, end + 1))
  }
  await db.exec(intake)
  await db.exec('grant usage on schema public,gridex_ediel_technical_ack to service_role; grant select,insert,update,delete on all tables in schema public to service_role;')
  await db.query('insert into companies(id,name) values($1,$2)', [company, 'Synthetic technical owner'])
  await db.query('insert into user_profiles(id) values($1)', [actor])
  await db.query('insert into company_memberships(company_id,user_id,accepted_at) values($1,$2,$3)', [company, actor, '2026-01-01T00:00:00Z'])
  await db.query(`insert into tenant_actor_identifiers(company_id,environment,actor_id,identifier_type,identifier_value,valid_from) values($1,'production',$2,'EdielId','54321','2026-01-01T00:00:00Z')`, [company, id(9)])
  await db.query(`insert into ediel_mailboxes(id,company_id,environment,mailbox_name,email_address,mailbox_type) values($1,$2,'production','Synthetic mailbox',$3,'tenant')`, [mailbox, company, smtp])
  await db.query(`insert into communication_routes(id,company_id,route_name,route_scope,environment_type,target_email) values($1,$2,'Synthetic CONTRL','ediel_ack','production','sender@example.invalid')`, [routeId, company])
  await db.query(`insert into ediel_route_profiles(id,company_id,communication_route_id,environment,is_active,message_family,business_code,sender_ediel_id,receiver_ediel_id,application_reference,mailbox,smtp_host,smtp_port) values($1,$2,$3,'production',true,'CONTRL','CONTRL','54321','12345','23-DDQ-PRODAT',$4,'smtp.example.invalid',465)`, [profileId, company, routeId, smtp])
}, 20000)
afterEach(async () => { await db?.close() })

async function admit({ legacy = false, mailboxAddress = smtp, payload = wire, code = 'Z04' }: { legacy?: boolean; mailboxAddress?: string; payload?: string; code?: string } = {}) {
  const payloadHash = createHash('sha256').update(payload).digest('hex')
  if (!legacy) await installForward()
  await db.query('update public.ediel_mailboxes set email_address=$1 where id=$2', [mailboxAddress, mailbox])
  // Explicit finite parser port: physically matching fields, then genuine SQL
  // selection/custody admission. No private receipt row is supplied by test.
  const raw = `From: sender@example.invalid\r\nTo: ${smtp}\r\nContent-Type: application/edifact\r\n\r\n${payload}`
  await service(() => db.query(`insert into public.inbound_email_messages(id,mailbox_id,company_id,environment,raw_email,raw_edifact_payload,body_text,received_at) values($1,$2,$3,'production',$4,$5,$5,'2026-10-05T00:00:00Z')`, [mail, mailbox, company, raw, payload]))
  const envelope = (await db.query<{ e: Row }>('select gridex_ediel_technical_ack.envelope($1) e', [payload])).rows[0].e
  await service(() => db.query(`insert into public.inbound_ediel_parse_results(id,inbound_email_message_id,company_id,message_family,message_code,sender_ediel_id,receiver_ediel_id,sender_sub_address,receiver_sub_address,interchange_reference,application_reference,parsed_payload,raw_payload) values($1,$2,null,'PRODAT',$7,'12345','54321',null,null,$3,$4,$5,$6)`, [parse, mail, envelope.interchangeReference, envelope.applicationReference, JSON.stringify({ rawPayload: payload }), payload, code]))
  // Real old raw/parse births precede the migration. Installing the forward
  // migration must not synthesize a new SMTP receipt for historical bytes.
  if (legacy) await installForward()
  const receipt = await service(async () => (await db.query<{ value: Row }>('select public.ediel_admit_unattributed_technical_source_v1($1,$2,$3,$4,$5) value', [mail, parse, actor, payloadHash, 'production'])).rows[0].value)
  const source = String(receipt.sourceMessageId)
  expect(receipt).toMatchObject({ companyId: null, resolvedCompanyId: null, technicalCompanyId: company, authorizesBusinessEffect: false })
  await service(() => db.query('select public.ediel_record_technical_syntax_facet_v2($1,$2,$3,$4,$5,$6)', [company, source, payloadHash, JSON.stringify({ version: 1, owner: 'canonical-runtime-syntax-v1', syntaxDecision: 'accepted', reasonCodes: [] }), actor, 'prepare']))
  // Actual durable syntax-to-reply capture, before the separately owned guide
  // layer. This tests route binding, not national ACK guide or emitted CONTRL.
  await db.query('select gridex_ediel_technical_ack.capture_reply_before_native_ack_guide_v1($1,$2)', [company, source])
  return source
}

async function installCommonSourceProducer() {
  for (const table of ['public.ediel_rule_packs', 'public.ediel_rule_pack_sources',
    'gridex_ediel_common_header.source_editions']) await db.exec(definition('TABLE', `${table} (`))
  for (const name of ['capture_source', 'require_v1', 'require_current_scope_v1', 'read_negative_route_v1']) await db.exec(definition('FUNCTION', `gridex_ediel_common_header.${name}(`))
  // Exact existing source-generated national catalog, never test-issued common
  // evidence. The current trigger below owns common source birth.
  const original = readFileSync('supabase/migrations/20260930205320_ediel_prodat_common_header_rejection_authority.sql', 'utf8')
  const projection = /^INSERT INTO gridex_ediel_common_header\.source_editions[^\n]+;/m.exec(original)
  if (!projection) throw Error('Missing actual common source projection')
  await db.exec(projection[0])
  // Declared finite registry input, not an observed native/market activation.
  await db.query(`insert into public.ediel_rule_packs(id,family,market,source_hash,status,valid_from,guide_version,guide_revision,unh_association_code,source_document) values($1,'PRODAT','electricity',$2,'active','2026-04-01','26.A','3','E2SE6A','Synthetic current registry input')`, [id(100), 'a'.repeat(64)])
  await db.query(`insert into public.ediel_rule_pack_sources(id,rule_pack_id,source_type,priority,title,source_hash) values($1,$2,'technical_guide',1,'Synthetic registry source row',$3)`, [id(101), id(100), 'b'.repeat(64)])
  const start = schema.indexOf('CREATE TRIGGER ediel_capture_common_prodat_header '), end = schema.indexOf(';', start)
  if (start < 0 || end < 0) throw Error('Missing actual common source trigger')
  await db.exec(schema.slice(start, end + 1))
}

describe('IMP05 protected unattributed original mailbox return route component', () => {
  it('routes a qualified common-header negative APERAK from a real NULL birth without legal attribution', async () => {
    await installCommonSourceProducer()
    const payload = "UNB+UNOC:3+12345:14+54321:14+261005:0000+IMP05-COMMON++23-DDQ-PRODAT'UNH+M+PRODAT:D:97A:UN:E2SE6A'BGM+ZZZ+D+9+AB'NAD+FR+12345:160:SVK+++++++SE'NAD+DO+54321:160:SVK+++++++SE'UNT+5+M'UNZ+1+IMP05-COMMON'"
    const source = await admit({ payload, code: 'ZZZ' })
    const payloadHash = createHash('sha256').update(payload).digest('hex')
    const original = await rows('public.ediel_messages')
    expect(original[0]).toMatchObject({ id: source, company_id: null, resolved_company_id: null, execution_context_snapshot: {} })
    const common = (await db.query<{ value: Row }>('select gridex_ediel_common_header.require_v1($1,$2,$3) value', [company, 'production', source])).rows[0].value
    expect(common).toMatchObject({ sourceMessageId: source, sourceHash: payloadHash, companyId: company,
      field202: { fieldCode: '202', ercCode: '42', text: 'Felaktigt Meddelandenamn ZZZ' }, authorizesBusinessEffect: false })
    await db.query(`update public.ediel_route_profiles set message_family='APERAK',business_code='APERAK' where id=$1`, [profileId])
    const result = (await db.query<{ value: Row }>('select gridex_ediel_common_header.read_negative_route_v1($1,$2,$3,$4,$5,$6) value', [company, actor, source, smtp, 'smtp.example.invalid', 465])).rows[0].value
    expect(result).toMatchObject({ kind: 'prodat_common_header_negative_ack_route', sourceMessageId: source, sourceHash: payloadHash,
      companyId: company, mailbox: smtp, routeRuntime: { message_family: 'APERAK' }, authorizesBusinessEffect: false })
    expect(await rows('public.ediel_messages')).toEqual(original)
    expect(await rows('gridex_ediel_inbound_receptions.receptions')).toEqual([])
    expect(await rows('gridex_received_sources.sources')).toEqual([])
    await db.query('update public.tenant_actor_identifiers set valid_to=now() where company_id=$1', [company])
    await expect(db.query('select gridex_ediel_common_header.read_negative_route_v1($1,$2,$3,$4,$5,$6)', [company, actor, source, smtp, 'smtp.example.invalid', 465])).rejects.toMatchObject({ message: 'ediel_common_header_current_identity_unavailable' })
    expect(await rows('public.ediel_messages')).toEqual(original)
  })

  it('routes a real prospective NULL birth to its original SMTP without ordinary reception or legal context', async () => {
    const source = await admit()
    const original = (await rows('public.ediel_messages'))[0]
    const rawBefore = await rows('public.inbound_email_messages')
    const parseBefore = await rows('public.inbound_ediel_parse_results')
    expect(original).toMatchObject({ id: source, company_id: null, resolved_company_id: null, execution_context_snapshot: {} })
    expect(await rows('gridex_ediel_inbound_receptions.receptions')).toEqual([])
    expect(await rows('gridex_received_sources.sources')).toEqual([])
    expect(await route(source)).toMatchObject({ kind: 'technical_syntax_ack_route', companyId: company, sourceMessageId: source,
      sourceHash: hash, mailbox: smtp, senderEdielId: '54321', receiverEdielId: '12345', authorizesBusinessEffect: false })
    expect(await rows('public.ediel_messages')).toEqual([original])
    expect(await rows('public.inbound_email_messages')).toEqual(rawBefore)
    expect(await rows('public.inbound_ediel_parse_results')).toEqual(parseBefore)
    expect(await rows('gridex_ediel_inbound_receptions.receptions')).toEqual([])
  }, 20000)

  it('holds a genuine legacy raw birth rather than backfilling its missing SMTP receipt', async () => {
    const source = await admit({ legacy: true })
    expect(await rows('gridex_unattributed_intake.raw_births')).toHaveLength(1)
    expect(await rows('gridex_unattributed_intake.technical_births')).toHaveLength(1)
    expect(await rows('gridex_ediel_inbound_receptions.technical_mailbox_births')).toEqual([])
    await expect(route(source)).rejects.toMatchObject({ message: 'ediel_original_mailbox_smtp_custody_required' })
    expect(await rows('gridex_ediel_inbound_receptions.receptions')).toEqual([])
  })

  it('retains protected intake with invalid birth SMTP but refuses a return route', async () => {
    const source = await admit({ mailboxAddress: 'invalid SMTP address' })
    expect(await rows('gridex_unattributed_intake.raw_births')).toHaveLength(1)
    expect(await rows('gridex_ediel_inbound_receptions.technical_mailbox_births')).toEqual([])
    await expect(route(source)).rejects.toMatchObject({ message: 'ediel_original_mailbox_smtp_custody_required' })
    expect((await rows('public.ediel_messages'))[0]).toMatchObject({ company_id: null, resolved_company_id: null, execution_context_snapshot: {} })
  })

  it('refuses a foreign technical company or actor and preserves a qualified control', async () => {
    const source = await admit()
    const original = await rows('public.ediel_messages')
    await expect(route(source, id(999))).rejects.toMatchObject({ message: 'ediel_technical_ack_basis_required' })
    await expect(route(source, company, id(999))).rejects.toMatchObject({ code: '42501' })
    expect(await route(source)).toMatchObject({ companyId: company, sourceHash: hash, mailbox: smtp })
    expect(await rows('public.ediel_messages')).toEqual(original)
  })

  it('refuses an actor whose actual membership is revoked and an endpoint whose identifier is gone', async () => {
    const source = await admit()
    await db.query('update public.company_memberships set is_active=false where company_id=$1 and user_id=$2', [company, actor])
    await expect(route(source)).rejects.toMatchObject({ code: '42501' })
    await db.query('update public.company_memberships set is_active=true where company_id=$1 and user_id=$2', [company, actor])
    await db.query('update public.tenant_actor_identifiers set valid_to=now() where company_id=$1', [company])
    await expect(route(source)).rejects.toMatchObject({ message: 'ediel_technical_endpoint_unqualified' })
  })

  it('rejects foreign hash, environment and source selectors applied to actual source evidence', async () => {
    await installCommonSourceProducer()
    const source = await admit()
    const evidence = (await db.query<{ value: Row }>('select gridex_ediel_technical_ack.require_source_v1($1,$2) value', [company, source])).rows[0].value
    // Adversarial caller input only: none of these objects is inserted as an
    // authoritative private receipt or substituted for a production verdict.
    for (const changed of [{ ...evidence, sourceHash: 'f'.repeat(64) }, { ...evidence, sourceMessageId: id(999) }]) {
      await expect(db.query('select gridex_ediel_technical_ack.select_configured_reply_route_v2($1,$2,$3,$4,$5,$6)', [company, changed, 'CONTRL', smtp, 'smtp.example.invalid', 465])).rejects.toMatchObject({ message: 'ediel_original_mailbox_source_required' })
    }
    await expect(db.query('select gridex_ediel_technical_ack.select_configured_reply_route_v2($1,$2,$3,$4,$5,$6)', [company, { ...evidence, environment: 'test' }, 'CONTRL', smtp, 'smtp.example.invalid', 465])).rejects.toMatchObject({ message: 'ediel_technical_endpoint_unqualified' })
    await expect(db.query('select gridex_ediel_technical_ack.select_configured_reply_route_v2($1,$2,$3,$4,$5,$6)', [company, evidence, 'APERAK', smtp, 'smtp.example.invalid', 465])).rejects.toMatchObject({ message: 'ediel_historical_common_header_basis_unavailable' })
    expect(await route(source)).toMatchObject({ sourceMessageId: source, sourceHash: hash, mailbox: smtp })
  })

  it('refuses a changed current SMTP even when a mutable route profile follows it', async () => {
    const source = await admit()
    const original = await rows('public.ediel_messages')
    const birth = await rows('gridex_ediel_inbound_receptions.technical_mailbox_births')
    const changed = 'replacement@example.invalid'
    await db.query('update public.ediel_mailboxes set email_address=$1 where id=$2', [changed, mailbox])
    // A mutable current address neither rewrites custody nor changes the
    // original SMTP return path while actual profile/from still match birth.
    expect(await route(source)).toMatchObject({ mailbox: smtp, sourceHash: hash })
    expect(await rows('gridex_ediel_inbound_receptions.technical_mailbox_births')).toEqual(birth)
    await db.query('update public.ediel_route_profiles set mailbox=$1 where id=$2', [changed, profileId])
    await expect(route(source, company, actor, changed)).rejects.toMatchObject({ message: 'ediel_original_mailbox_smtp_custody_required' })
    await db.query('update public.ediel_mailboxes set email_address=$1 where id=$2', [smtp, mailbox])
    await db.query('update public.ediel_route_profiles set mailbox=$1 where id=$2', [smtp, profileId])
    expect(await route(source)).toMatchObject({ mailbox: smtp })
    expect(await rows('public.ediel_messages')).toEqual(original)
  })

  it('preserves existing function authority and installs a private owner-bound invoker receipt', async () => {
    const existing = [
      'public.ediel_record_inbound_reception_v1(uuid,uuid,uuid,uuid,uuid)',
      'gridex_ediel_technical_ack.select_configured_reply_route_v2(uuid,jsonb,text,text,text,integer)',
    ]
    const authority = async (name: string) => (await db.query<Row>(`select oid,proowner,proacl,prosecdef,proconfig,provolatile,proparallel from pg_proc where oid=$1::regprocedure`, [name])).rows[0]
    const before = await Promise.all(existing.map(authority))
    await installForward()
    expect(await Promise.all(existing.map(authority))).toEqual(before)
    const state = (await db.query<Row>(`select t.relrowsecurity,t.relforcerowsecurity,
      t.relowner=c.proowner and c.proowner=a.proowner owner_matches,
      c.prosecdef,c.proconfig,
      has_table_privilege('service_role',t.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') service_table_access,
      has_table_privilege('anon',t.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') anon_table_access,
      has_table_privilege('authenticated',t.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') authenticated_table_access,
      has_function_privilege('service_role',c.oid,'EXECUTE') service_capture_access,
      has_function_privilege('anon',c.oid,'EXECUTE') anon_capture_access,
      has_function_privilege('authenticated',c.oid,'EXECUTE') authenticated_capture_access
      from pg_class t,pg_proc c,pg_proc a where
      t.oid='gridex_ediel_inbound_receptions.technical_mailbox_births'::regclass
      and c.oid='gridex_ediel_inbound_receptions.capture_technical_mailbox_birth_v1()'::regprocedure
      and a.oid='gridex_unattributed_intake.capture_custody_v1()'::regprocedure`)).rows[0]
    expect(state).toEqual({ relrowsecurity: true, relforcerowsecurity: true, owner_matches: true,
      prosecdef: false, proconfig: ['search_path=pg_catalog'], service_table_access: false, anon_table_access: false,
      authenticated_table_access: false, service_capture_access: false, anon_capture_access: false, authenticated_capture_access: false })
    expect(await rows('gridex_ediel_inbound_receptions.technical_mailbox_births')).toEqual([])
  })

  it('refuses changed mailbox company or environment through genuine raw custody', async () => {
    const source = await admit()
    const before = await rows('public.ediel_messages')
    await db.query('update public.ediel_mailboxes set company_id=$1 where id=$2', [id(999), mailbox])
    await expect(route(source)).rejects.toMatchObject({ message: 'ediel_technical_intake_original_custody_required' })
    await db.query('update public.ediel_mailboxes set company_id=$1,environment=$2 where id=$3', [company, 'test', mailbox])
    await expect(route(source)).rejects.toMatchObject({ message: 'ediel_technical_intake_original_custody_required' })
    await db.query('update public.ediel_mailboxes set environment=$1 where id=$2', ['production', mailbox])
    expect(await route(source)).toMatchObject({ mailbox: smtp })
    expect(await rows('public.ediel_messages')).toEqual(before)
  })

  it('rechecks actual raw custody after the mailbox lock when its hashed type changed in the check gap', async () => {
    const source = await admit()
    expect(await route(source)).toMatchObject({ mailbox: smtp })
    // Test-only deterministic scheduling port. The actual original custody
    // function still executes, then one mutable mailbox input changes before
    // the selector locks it. This is not a native concurrency/isolation proof.
    await db.exec(`alter function gridex_unattributed_intake.require_custody_v1(uuid,uuid) rename to fixture_actual_require_custody_v1;
      create function gridex_unattributed_intake.require_custody_v1(mail_id uuid,parse_id uuid) returns void
      language plpgsql security definer set search_path to pg_catalog as $$begin
        perform gridex_unattributed_intake.fixture_actual_require_custody_v1(mail_id,parse_id);
        if coalesce(current_setting('imp05_fixture.gap_once',true),'')<> 'done' then
          perform set_config('imp05_fixture.gap_once','done',false);
          update public.ediel_mailboxes set mailbox_type='shared' where id='${mailbox}'::uuid;
        end if;
      end$$;`)
    await expect(route(source)).rejects.toMatchObject({ message: 'ediel_technical_intake_original_custody_required', code: '23514' })
    // The failed statement rolls back the finite hook's mutation as well.
    expect((await rows('public.ediel_mailboxes'))[0]).toMatchObject({ mailbox_type: 'tenant' })
    expect((await rows('public.ediel_messages'))[0]).toMatchObject({ company_id: null, resolved_company_id: null, execution_context_snapshot: {} })
  })

  it('keeps the prospective SMTP receipt private and immutable and refuses legal attribution', async () => {
    const source = await admit()
    const before = await rows('gridex_ediel_inbound_receptions.technical_mailbox_births')
    expect(before).toHaveLength(1)
    expect(before[0]).toMatchObject({ inbound_email_message_id: mail, mailbox_id: mailbox, environment: 'production', mailbox_company_id: company, smtp_address: smtp })
    await expect(service(() => db.query('select * from gridex_ediel_inbound_receptions.technical_mailbox_births'))).rejects.toMatchObject({ code: '42501' })
    await expect(db.query('update gridex_ediel_inbound_receptions.technical_mailbox_births set smtp_address=$1', ['forged@example.invalid'])).rejects.toMatchObject({ code: '23514' })
    await expect(db.exec('truncate gridex_ediel_inbound_receptions.technical_mailbox_births')).rejects.toMatchObject({ code: '23514' })
    await expect(service(() => db.query('update public.ediel_messages set company_id=$1,resolved_company_id=$1 where id=$2', [company, source]))).rejects.toMatchObject({ code: '23514' })
    expect(await rows('gridex_ediel_inbound_receptions.technical_mailbox_births')).toEqual(before)
    expect((await rows('public.ediel_messages'))[0]).toMatchObject({ company_id: null, resolved_company_id: null, execution_context_snapshot: {} })
    expect(await rows('gridex_ediel_inbound_receptions.receptions')).toEqual([])
  })
})
