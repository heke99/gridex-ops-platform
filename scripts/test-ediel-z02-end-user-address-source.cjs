// Finite real PostgreSQL source-reader regression. Public process rows and
// private transport journal observations below are declared synthetic fixtures.
// This gate does not prove a public accepted producer, Supabase native replay,
// authentic customer agreement, market acceptance, or either whole contract.
/* eslint-disable @typescript-eslint/no-require-imports -- This regression entry point is intentionally CommonJS. */
const {test} = require('node:test')
const assert = require('node:assert/strict')
const {readFileSync} = require('node:fs')
const path = require('node:path')
const {createHash} = require('node:crypto')
const {PGlite} = require('@electric-sql/pglite')
/* eslint-enable @typescript-eslint/no-require-imports */

const signature = 'public.gridex_ediel_received_z02_address_source_basis_v1(uuid,uuid)'
const migration = path.join(__dirname, '../supabase/migrations/20261007093025_received_z02_address_source_basis.sql')
const uid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const hash = value => createHash('sha256').update(value).digest('hex')
const literal = value => `'${String(value).replaceAll("'", "''")}'`
const ids = {company:uid(1),actor:uid(2),customer:uid(3),site:uid(4),grid:uid(5),request:uid(6),operation:uid(7),snapshot:uid(8),original:uid(9),source:uid(10),attempt:uid(11)}
const rendered = '2026-10-06T12:00:00Z', accepted = '2026-10-06T12:01:00Z', received = '2026-10-06T12:02:00Z'

function definition(file, name) {
  const source = readFileSync(path.join(__dirname, '../supabase/migrations', file), 'utf8')
  const start = source.indexOf(`CREATE FUNCTION ${name}`)
  const end = source.indexOf('$$;', start)
  assert.ok(start >= 0 && end > start, `actual SQL dependency ${name} must exist`)
  return source.slice(start, end + 3)
}
function wire(code, address = 'Registered street') {
  const sender = code === 'Z01' ? '12345' : '54321', receiver = code === 'Z01' ? '54321' : '12345'
  const segments = [`UNB+UNOC:3+${sender}:14+${receiver}:14+261006:1200+I++23-DDQ-PRODAT`,
    'UNH+1+PRODAT:D:97A:UN:E2SE6A', `BGM+${code}+DOC+9`, `NAD+FR+${sender}:160:SVK`, `NAD+DO+${receiver}:160:SVK`,
    'LIN+1++POINT:::9', 'CCI++Z13', 'CAV+Z22', 'RFF+LI:OWN-LI', 'RFF+Z05:TES',
    `NAD+UD+5566778899:SE1:260++Own customer+${address}+City++12345+SE`,
    'NAD+IT+++Installation+Installation street+Installation city++22222+SE']
  segments.push(`UNT+${segments.length}+1`, 'UNZ+1+I')
  return segments.join("'") + "'"
}

async function setup(db) {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE public.user_profiles(id uuid PRIMARY KEY, user_status text);
    CREATE TABLE public.company_memberships(id uuid PRIMARY KEY, company_id uuid, user_id uuid, status text, is_active boolean, accepted_at timestamptz);
    CREATE TABLE public.declared_actor_permissions(actor uuid, company uuid, permission text, enabled boolean);
    CREATE FUNCTION public.gridex_actor_has_company_permission(uuid,uuid,text) RETURNS boolean LANGUAGE sql AS $$
      SELECT coalesce((SELECT enabled FROM public.declared_actor_permissions WHERE actor=$1 AND company=$2 AND permission=$3),false) $$;
    CREATE TABLE public.customers(id uuid PRIMARY KEY,company_id uuid,org_number text,personal_number text,name text);
    CREATE TABLE public.customer_sites(id uuid PRIMARY KEY,company_id uuid,customer_id uuid,facility_id text,normalized_facility_id text,grid_owner_id uuid,address_hash text,street text,postal_code text,city text);
    CREATE TABLE public.customer_info_requests(id uuid PRIMARY KEY,company_id uuid,customer_id uuid,site_id uuid,grid_owner_id uuid,operation_id uuid,ediel_message_id uuid);
    CREATE TABLE public.customer_operation_request_snapshots(id uuid PRIMARY KEY,company_id uuid,operation_id uuid,customer_id uuid,customer_site_id uuid,request_kind text,request_reference text,superseded_at timestamptz,site_address_hash text,grid_owner_id uuid);
    CREATE TABLE public.ediel_messages(id uuid PRIMARY KEY,company_id uuid,environment text,direction text,message_standard text,message_family text,message_code text,raw_payload text,immutable_payload_hash text,immutable_rendered_at timestamptz,message_received_at timestamptz,message_sent_at timestamptz,customer_id uuid,site_id uuid,parsed_payload jsonb,status text,original_message_id uuid,grid_owner_id uuid);
    CREATE TABLE public.ediel_business_references(id uuid PRIMARY KEY,company_id uuid,source_message_id uuid,message_family text,message_code text,reference_type text,reference_value text);
    CREATE SCHEMA gridex_received_sources;
    CREATE TABLE gridex_received_sources.sources(source_message_id uuid PRIMARY KEY,company_id uuid,environment text,message_code text,raw_payload text,payload_hash text,source_received_at timestamptz,received_context jsonb);
    CREATE TABLE gridex_received_sources.validation_assessments(id uuid PRIMARY KEY,source_message_id uuid,facts_text text);
    CREATE SCHEMA gridex_customer_masterdata;
    CREATE TABLE gridex_customer_masterdata.preparations(id uuid PRIMARY KEY);
    CREATE TABLE gridex_customer_masterdata.originals(message_id uuid PRIMARY KEY);
    CREATE SCHEMA gridex_ediel_transport;
    CREATE TABLE gridex_ediel_transport.attempts(id uuid PRIMARY KEY,message_id uuid,company_id uuid,environment text,binding jsonb,provider_result jsonb,classification text,entered_at timestamptz,observed_at timestamptz);
    CREATE SCHEMA gridex_ediel_retention;
    CREATE TABLE gridex_ediel_retention.blob_tombstones(company_id uuid,message_id uuid);
    CREATE SCHEMA gridex_outbound_dispatch;
    CREATE TABLE gridex_outbound_dispatch.attempts(id uuid PRIMARY KEY,message_id uuid,company_id uuid,environment text,binding jsonb);
    CREATE TABLE gridex_outbound_dispatch.originals(message_id uuid PRIMARY KEY,company_id uuid,environment text,payload_hash text,raw_payload text);
    CREATE TABLE gridex_outbound_dispatch.events(id uuid PRIMARY KEY,attempt_id uuid,message_id uuid,company_id uuid,environment text,kind text,facts jsonb,observed_at timestamptz);`)
  for (const [file,name] of [
    ['20260930144205_ediel_permission_source_atomic_transitions.sql','gridex_received_sources.wire_tokens_bounded_v1'],
    ['20260930144205_ediel_permission_source_atomic_transitions.sql','gridex_received_sources.closure_wire_tokens_v2'],
    ['20260930154552_ediel_z02_source_owned_core.sql','gridex_received_sources.z02_core_wire_v1'],
    ['20260930204937_ediel_shared_accepted_source_basis.sql','gridex_ediel_transport.accepted_source_basis_v1'],
    ['20261001000700_ediel_message_content_and_mime_retention.sql','public.ediel_require_source_bytes_available_v1'],
  ]) await db.exec(definition(file,name))
  await db.exec(`REVOKE ALL ON FUNCTION gridex_ediel_transport.accepted_source_basis_v1(public.ediel_messages) FROM PUBLIC,anon,authenticated,service_role;
    INSERT INTO user_profiles VALUES('${ids.actor}','active');
    INSERT INTO company_memberships VALUES('${uid(12)}','${ids.company}','${ids.actor}','active',true,'${rendered}');
    INSERT INTO declared_actor_permissions VALUES('${ids.actor}','${ids.company}','ediel.read',true),('${ids.actor}','${ids.company}','communication.read',false);
    INSERT INTO customers VALUES('${ids.customer}','${ids.company}','5566778899',NULL,'Own customer');
    INSERT INTO customer_sites VALUES('${ids.site}','${ids.company}','${ids.customer}','POINT','POINT','${ids.grid}','installation street|22222|installation city','Installation street','22222','Installation city');
    INSERT INTO ediel_business_references VALUES('${uid(13)}','${ids.company}','${ids.original}','PRODAT','Z01','RFF_LI','OWN-LI');
    INSERT INTO customer_info_requests VALUES('${ids.request}','${ids.company}','${ids.customer}','${ids.site}','${ids.grid}','${ids.operation}','${ids.original}');
    INSERT INTO customer_operation_request_snapshots VALUES('${ids.snapshot}','${ids.company}','${ids.operation}','${ids.customer}','${ids.site}','customer_data_request','${ids.request}',NULL,'installation street|22222|installation city','${ids.grid}');`)
  const original = wire('Z01'), source = wire('Z02', 'New inbound street')
  for (const [id,code,direction,raw] of [[ids.original,'Z01','outbound',original],[ids.source,'Z02','inbound',source]]) {
    await db.query(`INSERT INTO ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,raw_payload,immutable_payload_hash,immutable_rendered_at,message_received_at,message_sent_at,customer_id,site_id,parsed_payload,status) VALUES($1,$2,'test',$3,'edifact','PRODAT',$4,$5,$6,$7,$8,$9,$10,$11,'{}','received')`,
      [id,ids.company,direction,code,raw,hash(raw),rendered,direction==='inbound'?received:null,direction==='outbound'?accepted:null,ids.customer,ids.site])
  }
  await db.exec(`INSERT INTO gridex_received_sources.sources SELECT id,company_id,environment,message_code,raw_payload,immutable_payload_hash,message_received_at,to_jsonb(m) FROM ediel_messages m WHERE id='${ids.source}';`)
  await db.query(`INSERT INTO gridex_ediel_transport.attempts VALUES($1,$2,$3,'test',$4,$5,'accepted',$6,$7)`,
    [ids.attempt,ids.original,ids.company,{originalHash:hash(original),to:'recipient@example.invalid'},
      {accepted:['recipient@example.invalid'],rejected:[],messageId:'DECLARED-UNIT-RECEIPT',response:'synthetic unit receipt'},rendered,accepted])
  // Missing migration is an intended RED: the real reader must be installed.
  let sql
  try { sql = readFileSync(migration,'utf8') } catch (error) {
    if (error.code === 'ENOENT') assert.fail('received Z02 address source SQL reader is absent')
    throw error
  }
  await db.exec(sql)
}

async function read(db, source = ids.source, actor = ids.actor, role = 'service_role') {
  await db.exec(`SET ROLE ${role}`)
  try {
    return (await db.query('SELECT public.gridex_ediel_received_z02_address_source_basis_v1($1,$2) basis',[source,actor])).rows[0].basis
  } finally { await db.exec('RESET ROLE').catch(() => {}) }
}
async function effects(db) {
  const tables = ['public.ediel_messages','public.customer_info_requests','public.customer_operation_request_snapshots',
    'public.customers','public.customer_sites','public.ediel_business_references','gridex_received_sources.sources','gridex_received_sources.validation_assessments',
    'gridex_customer_masterdata.preparations','gridex_customer_masterdata.originals','gridex_ediel_transport.attempts',
    'gridex_outbound_dispatch.attempts','gridex_outbound_dispatch.originals','gridex_outbound_dispatch.events','gridex_ediel_retention.blob_tombstones']
  return (await db.query(`SELECT jsonb_build_object(${tables.flatMap(table=>[literal(table),`(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]') FROM ${table} r)`]).join(',')}) state`)).rows[0].state
}

async function mutateWire(db, which, raw) {
  const id = which === 'source' ? ids.source : ids.original
  await db.query('UPDATE ediel_messages SET raw_payload=$1,immutable_payload_hash=$2 WHERE id=$3',[raw,hash(raw),id])
  if (which === 'source') await db.query('UPDATE gridex_received_sources.sources SET raw_payload=$1,payload_hash=$2 WHERE source_message_id=$3',[raw,hash(raw),id])
  else await db.query("UPDATE gridex_ediel_transport.attempts SET binding=jsonb_set(binding,'{originalHash}',to_jsonb($1::text)) WHERE message_id=$2",[hash(raw),id])
}
async function isolated(db, mutation, assertion) {
  await db.exec('BEGIN')
  try { await mutation(); await assertion() } finally { await db.exec('ROLLBACK') }
}

test('finite actual SQL received-Z02 source qualification', async t => {
  const db = new PGlite()
  try {
    await setup(db)
    await t.test('installs the real source reader',async()=>{
      assert.notEqual((await db.query('SELECT to_regprocedure($1) reader',[signature])).rows[0].reader,null)
    })
    await t.test('reads own accepted original when incoming end-user address differs',async()=>{
      const before = await effects(db), basis = await read(db)
      assert.ok(basis,'an own sealed original with the declared accepted journal must qualify')
      assert.equal(basis.status,'z02_address_source_basis')
      assert.equal(basis.originalRawPayload,wire('Z01'))
      assert.equal(basis.sourceRawPayload,wire('Z02','New inbound street'))
      assert.deepEqual(await effects(db),before,'source lookup must create zero effects')
    })
    await t.test('returns exact company/environment/request/object/hash and frozen receipt binding',async()=>{
      const b = await read(db)
      assert.equal(b.version,1); assert.equal(b.companyId,ids.company); assert.equal(b.environment,'test')
      assert.equal(b.sourceMessageId,ids.source); assert.equal(b.sourcePayloadHash,hash(wire('Z02','New inbound street')))
      assert.equal(b.originalMessageId,ids.original); assert.equal(b.originalPayloadHash,hash(wire('Z01')))
      assert.equal(b.request.id,ids.request); assert.equal(b.requestSnapshot.id,ids.snapshot)
      assert.equal(b.customer.id,ids.customer); assert.equal(b.site.id,ids.site)
      assert.equal(b.sourceObject.objectId,'POINT'); assert.equal(b.sourceObject.identityAgency,'9')
      assert.equal(b.sourceObject.lineReference,'OWN-LI'); assert.equal(b.originalObject.lineReference,'OWN-LI')
      assert.equal(b.acceptedTransport.id,ids.attempt); assert.equal(b.acceptedTransportReceipt.attemptId,ids.attempt)
      assert.equal(b.acceptedTransportReceipt.authorizesProviderEntry,false)
      assert.equal(b.acceptedTransportReceipt.deliveryProven,false)
    })
    await t.test('service-only public RPC and private implementation have narrow SQL ACLs',async()=>{
      for (const role of ['anon','authenticated']) {
        assert.equal((await db.query("SELECT has_function_privilege($1,$2,'EXECUTE') allowed",[role,signature])).rows[0].allowed,false)
        await assert.rejects(()=>read(db,ids.source,ids.actor,role),{code:'42501'})
      }
      assert.equal((await db.query("SELECT has_function_privilege('service_role',$1,'EXECUTE') allowed",[signature])).rows[0].allowed,true)
      assert.equal((await db.query("SELECT has_function_privilege('service_role','gridex_received_sources.z02_address_source_basis_v1(uuid,uuid)','EXECUTE') allowed")).rows[0].allowed,false)
      await assert.rejects(()=>db.query('SELECT public.gridex_ediel_received_z02_address_source_basis_v1($1,$2)',[ids.source,ids.actor]),{code:'42501'})
      const functions = (await db.query("SELECT prosecdef,proconfig FROM pg_proc WHERE oid IN($1::regprocedure,'gridex_received_sources.z02_address_source_basis_v1(uuid,uuid)'::regprocedure)",[signature])).rows
      assert.equal(functions.length,2)
      for (const f of functions) {assert.equal(f.prosecdef,true); assert.ok(f.proconfig.includes('search_path=pg_catalog')); assert.ok(f.proconfig.includes('TimeZone=UTC'))}
    })
    const refusals = [
      ['requires the frozen source row',()=>db.exec(`DELETE FROM gridex_received_sources.sources`)],
      ['refuses source/mutable message hash mismatch',()=>db.exec(`UPDATE ediel_messages SET immutable_payload_hash=repeat('0',64) WHERE id='${ids.source}'`)],
      ['refuses mutually copied hashes that disagree with real source bytes',()=>db.exec(`UPDATE ediel_messages SET immutable_payload_hash=repeat('0',64) WHERE id='${ids.source}';UPDATE gridex_received_sources.sources SET payload_hash=repeat('0',64)`)],
      ['refuses source/message raw byte drift',()=>db.exec(`UPDATE ediel_messages SET raw_payload=raw_payload||' ' WHERE id='${ids.source}'`)],
      ['refuses source received time drift',()=>db.exec(`UPDATE gridex_received_sources.sources SET source_received_at=source_received_at+interval '1 second'`)],
      ['refuses nonfinite received time',()=>db.exec(`UPDATE gridex_received_sources.sources SET source_received_at='infinity';UPDATE ediel_messages SET message_received_at='infinity' WHERE id='${ids.source}'`)],
      ['refuses cross-environment original reuse',()=>db.exec(`UPDATE ediel_messages SET environment='production' WHERE id='${ids.original}'`)],
      ['refuses cross-company original reuse',()=>db.exec(`UPDATE ediel_messages SET company_id='${uid(90)}' WHERE id='${ids.original}'`)],
      ['refuses cross-company customer attribution',()=>db.exec(`UPDATE customers SET company_id='${uid(90)}'`)],
      ['refuses cross-customer site attribution',()=>db.exec(`UPDATE customer_sites SET customer_id='${uid(90)}'`)],
      ['refuses missing source customer/site scope',()=>db.exec(`UPDATE ediel_messages SET customer_id=NULL,site_id=NULL WHERE id='${ids.source}'`)],
      ['refuses original hash corruption',()=>db.exec(`UPDATE ediel_messages SET immutable_payload_hash=repeat('0',64) WHERE id='${ids.original}'`)],
      ['refuses unsealed original bytes',()=>db.exec(`UPDATE ediel_messages SET immutable_rendered_at=NULL WHERE id='${ids.original}'`)],
      ['refuses no prospective original request',()=>db.exec(`DELETE FROM customer_info_requests`)],
      ['refuses multiple physically matching requests',()=>db.exec(`INSERT INTO customer_info_requests SELECT '${uid(30)}',company_id,customer_id,site_id,grid_owner_id,operation_id,ediel_message_id FROM customer_info_requests`)],
      ['refuses missing source-owned original LI register',()=>db.exec(`DELETE FROM ediel_business_references`)],
      ['refuses copied LI from another original',()=>db.exec(`UPDATE ediel_business_references SET source_message_id='${uid(90)}'`)],
      ['refuses a different incoming point',()=>mutateWire(db,'source',wire('Z02').replace('POINT:::9','OTHER:::9'))],
      ['refuses a different incoming identity agency',()=>mutateWire(db,'source',wire('Z02').replace('POINT:::9','POINT:::89'))],
      ['refuses a different incoming LI',()=>mutateWire(db,'source',wire('Z02').replace('LI:OWN-LI','LI:OTHER-LI'))],
      ['refuses a different incoming subtype',()=>mutateWire(db,'source',wire('Z02').replace('CAV+Z22','CAV+Z23'))],
      ['refuses unreversed incoming legal party',()=>mutateWire(db,'source',wire('Z02').replace('NAD+FR+54321','NAD+FR+99999'))],
      ['refuses copied transport ID in a different UNB qualifier namespace',()=>mutateWire(db,'source',wire('Z02').replace('UNOC:3+54321:14','UNOC:3+54321:ZZ'))],
      ['refuses unreversed incoming transport party',()=>mutateWire(db,'source',wire('Z02').replace('UNOC:3+54321:14','UNOC:3+99999:14'))],
      ['refuses original for another customer identity',()=>mutateWire(db,'original',wire('Z01').replace('5566778899:SE1:260','1111111111:SE1:260'))],
      ['refuses repeated incoming same point objects',()=>mutateWire(db,'source',wire('Z02').replace("UNT+", "LIN+2++POINT:::9'CCI++Z13'CAV+Z22'RFF+LI:OWN-LI'UNT+"))],
      ['refuses repeated original same point objects',()=>mutateWire(db,'original',wire('Z01').replace("UNT+", "LIN+2++POINT:::9'CCI++Z13'CAV+Z22'RFF+LI:OWN-LI'UNT+"))],
      ['refuses missing original request snapshot',()=>db.exec(`DELETE FROM customer_operation_request_snapshots`)],
      ['refuses ambiguous current original request snapshots',()=>db.exec(`INSERT INTO customer_operation_request_snapshots SELECT '${uid(31)}',company_id,operation_id,customer_id,customer_site_id,request_kind,request_reference,superseded_at,site_address_hash,grid_owner_id FROM customer_operation_request_snapshots`)],
      ['refuses superseded original request snapshot',()=>db.exec(`UPDATE customer_operation_request_snapshots SET superseded_at='${received}'`)],
      ['refuses changed installation address snapshot',()=>db.exec(`UPDATE customer_operation_request_snapshots SET site_address_hash='drifted'`)],
      ['refuses original IT different from current installation',()=>mutateWire(db,'original',wire('Z01').replace('Installation street','Forged installation'))],
      ['refuses changed site grid owner',()=>db.exec(`UPDATE customer_sites SET grid_owner_id='${uid(90)}'`)],
      ['refuses no actual accepted journal observation',()=>db.exec(`DELETE FROM gridex_ediel_transport.attempts`)],
      ['refuses a nonaccepted provider classification',()=>db.exec(`UPDATE gridex_ediel_transport.attempts SET classification='failed'`)],
      ['refuses accepted observation later than received source',()=>db.exec(`UPDATE gridex_ediel_transport.attempts SET observed_at='2026-10-06T12:03:00Z'`)],
      ['refuses provider entry later than accepted observation',()=>db.exec(`UPDATE gridex_ediel_transport.attempts SET entered_at='2026-10-06T12:01:30Z'`)],
      ['refuses original render later than provider entry',()=>db.exec(`UPDATE ediel_messages SET immutable_rendered_at='2026-10-06T12:00:30Z' WHERE id='${ids.original}'`)],
    ]
    for (const [name,mutate] of refusals) await t.test(name,()=>isolated(db,mutate,async()=>{
      const before = await effects(db)
      assert.equal(await read(db),null)
      assert.deepEqual(await effects(db),before,'an unavailable-source read must create zero effects')
    }))
    const denied = [
      ['revoked current read permission',()=>db.exec(`UPDATE declared_actor_permissions SET enabled=false`)],
      ['inactive current actor profile',()=>db.exec(`UPDATE user_profiles SET user_status='inactive'`)],
      ['inactive current membership',()=>db.exec(`UPDATE company_memberships SET is_active=false`)],
      ['unaccepted current membership',()=>db.exec(`UPDATE company_memberships SET accepted_at=NULL`)],
    ]
    for (const [name,mutate] of denied) await t.test(`denies ${name}`,()=>isolated(db,mutate,async()=>{
      await assert.rejects(()=>read(db),{code:'42501'})
    }))
    for (const [name,mutate,message] of [
      ['ambiguous accepted journal observations',()=>db.exec(`INSERT INTO gridex_ediel_transport.attempts SELECT '${uid(32)}',message_id,company_id,environment,binding,provider_result,classification,entered_at,observed_at FROM gridex_ediel_transport.attempts`),'ediel_accepted_projection_ambiguous'],
      ['accepted receipt for another recipient',()=>db.exec(`UPDATE gridex_ediel_transport.attempts SET provider_result=jsonb_set(provider_result,'{accepted}','["other@example.invalid"]')`),'ediel_accepted_projection_expected_recipient_required'],
      ['missing actual provider entry',()=>db.exec(`UPDATE gridex_ediel_transport.attempts SET entered_at=NULL`),'ediel_accepted_projection_receipt_invalid'],
      ['corrupted accepted original hash',()=>db.exec(`UPDATE gridex_ediel_transport.attempts SET binding=jsonb_set(binding,'{originalHash}',to_jsonb(repeat('0',64)))`),'ediel_accepted_projection_original_changed'],
    ]) await t.test(`rejects ${name} through the real accepted-receipt guard`,()=>isolated(db,mutate,async()=>{
      await assert.rejects(()=>read(db),error=>error.message.includes(message))
    }))
    for (const [name,id] of [['received source',ids.source],['selected original',ids.original]]) {
      await t.test(`rejects ${name} retention tombstone through the actual custody guard`,()=>isolated(db,
        ()=>db.query('INSERT INTO gridex_ediel_retention.blob_tombstones VALUES($1,$2)',[ids.company,id]),async()=>{
          await assert.rejects(()=>read(db),error=>error.message.includes('ediel_original_bytes_retention_tombstoned'))
        }))
    }
    await t.test('unrelated physically mismatched original tombstone does not poison own current source',()=>isolated(db,
      async()=>{
        await db.exec(`INSERT INTO ediel_messages SELECT '${uid(40)}',company_id,environment,direction,message_standard,message_family,message_code,raw_payload,immutable_payload_hash,immutable_rendered_at,message_received_at,message_sent_at,customer_id,site_id,parsed_payload,status,original_message_id,grid_owner_id FROM ediel_messages WHERE id='${ids.original}';
          INSERT INTO customer_info_requests SELECT '${uid(41)}',company_id,customer_id,site_id,grid_owner_id,operation_id,'${uid(40)}' FROM customer_info_requests;
          INSERT INTO gridex_ediel_retention.blob_tombstones VALUES('${ids.company}','${uid(40)}');`)
        const raw = wire('Z01').replace('POINT:::9','OTHER:::9')
        await db.query('UPDATE ediel_messages SET raw_payload=$1,immutable_payload_hash=$2 WHERE id=$3',[raw,hash(raw),uid(40)])
      },async()=>{
        const before = await effects(db)
        assert.equal((await read(db)).originalMessageId,ids.original)
        assert.deepEqual(await effects(db),before)
      }))
    await t.test('communication.read authorizes lookup without any SEND or write permission',()=>isolated(db,
      ()=>db.exec(`UPDATE declared_actor_permissions SET enabled=(permission='communication.read')`),async()=>{
        const before = await effects(db)
        assert.equal((await read(db)).status,'z02_address_source_basis')
        assert.deepEqual(await effects(db),before)
      }))
    await t.test('incoming UD absence and changed identity do not circularly hide original availability',()=>isolated(db,
      ()=>mutateWire(db,'source',wire('Z02').replace('5566778899:SE1:260','1111111111:SE1:260').replace('Registered street','')),async()=>{
        assert.equal((await read(db)).originalRawPayload,wire('Z01'))
      }))
    await t.test('preserves explicitly empty original end-user address without invoice fallback',()=>isolated(db,
      ()=>mutateWire(db,'original',wire('Z01','')),async()=>{
        assert.equal((await read(db)).originalRawPayload,wire('Z01',''))
      }))
    await t.test('parsed caller address flags grant no authority when receipt is missing',()=>isolated(db,
      ()=>db.exec(`UPDATE ediel_messages SET parsed_payload='{"endUserAddressAvailable":true,"customerMasterdataSourceContextId":"${uid(90)}"}' WHERE id='${ids.source}';DELETE FROM gridex_ediel_transport.attempts`),async()=>{
        assert.equal(await read(db),null)
      }))
    await t.test('repeated reads preserve original bytes and all SQL effects',async()=>{
      const before = await effects(db), first = await read(db)
      assert.deepEqual(await read(db),first)
      assert.deepEqual(await effects(db),before)
      assert.deepEqual(before['gridex_received_sources.validation_assessments'],[])
      assert.deepEqual(before['gridex_customer_masterdata.preparations'],[])
      assert.deepEqual(before['gridex_customer_masterdata.originals'],[])
    })
  } finally { await db.close() }
})

// Additive scalar-only regression: declared synthetic strings and sentinel, no
// accepted producer, source capability, market authority or native credit.
{
const scalarLegacyFile = path.join(__dirname, '../supabase/migrations/20260903070000_harden_inbound_z02_required_payload_gate.sql')
const legacyFull = readFileSync(scalarLegacyFile, 'utf8')
const scalarBlocks = ['gridex_edifact_cci_cav_value','gridex_edifact_nad_element'].map(name => {
 const start = legacyFull.indexOf(`create or replace function public.${name}(`)
 const end = legacyFull.indexOf('$$;', start)
 assert.ok(start >= 0 && end > start, 'actual immutable scalar definition must exist')
 return legacyFull.slice(start, end + 3)
})
const scalarAcl = legacyFull.split('\n').filter(line => /^(revoke all|grant execute) on function public\.gridex_edifact_(cci_cav_value|nad_element)\(/.test(line)).join('\n')
const original = scalarBlocks.join('\n\n') + '\n' + scalarAcl
const scalarForwardFile = path.join(__dirname, '../supabase/migrations/20261007074502_received_z02_payload_scalar_readers.sql')
let proposed = null
try { proposed = readFileSync(scalarForwardFile, 'utf8') } catch (error) { if (error.code !== 'ENOENT') throw error }
// Missing proposed forward executes every physical oracle against unchanged old
// scalar SQL and fails on actual NULL values; it never skips a test or grants facts.
const wire = "CCI++Z04'CAV+Z04'CCI++Z13'CAV+Z22'NAD+UD+199001011234:SE2:260++Original Name+Original Street+Original City++12345+SE'NAD+IT+735123456789508946::9++Site Name+Site Street+Site City++54321+SE'";
const c = (name, raw, qualifier, expected) => ({name, query:'SELECT public.gridex_edifact_cci_cav_value($1,$2) value', values:[raw,qualifier], expected});
const n = (name, raw, qualifier, index, expected) => ({name, query:'SELECT public.gridex_edifact_nad_element($1,$2,$3) value', values:[raw,qualifier,index], expected});
const cases = [c('physical method217',wire,'Z04','Z04'), c('physical reason223 Z22',wire,'Z13','Z22'),
  c('physical reason223 Z23',wire.replace('CAV+Z22','CAV+Z23'),'Z13','Z23'),
  c('method never borrows adjacent reason',wire,'Z04','Z04'),
  c('reason never borrows adjacent method',wire,'Z13','Z22'),
  c('whitespace between physical CCI/CAV',"CCI++Z04'\r\n CAV+Z04'",'Z04','Z04'),
  c('CAV excludes actual carriage return',"CCI++Z04'CAV+Z04\rIGNORED'",'Z04','Z04'),
  c('CAV excludes actual newline',"CCI++Z04'CAV+Z04\nIGNORED'",'Z04','Z04'),
  c('r/n letters remain physical value',"CCI++Z04'CAV+winter'",'Z04','winter'),
  c('retains last colon component',"CCI++Z04'CAV+FIRST:SECOND:Z04'",'Z04','Z04'),
  c('retains CAV first element',"CCI++Z04'CAV+Z04+OTHER'",'Z04','Z04'),
  c('missing physical descriptor',wire,'Z99',null),c('missing CAV',"CCI++Z04'RFF+LI:A'",'Z04',null),
  c('empty CAV',"CCI++Z04'CAV+'",'Z04',null),c('blank CAV',"CCI++Z04'CAV+   '",'Z04',null),
  c('null raw',null,'Z04',null),c('empty raw','','Z04',null),c('null descriptor',wire,null,null),
  c('empty descriptor',wire,'',null),c('metachar descriptor is not wildcard',"CCI++ZX4'CAV+Z04'",'Z.4',null),
  c('regex injection cannot choose another descriptor',wire,'Z04|Z13',null),
  c('SQL-like descriptor cannot change sentinel',wire,"Z04'; DELETE FROM public.scalar_sentinel; --",null),
  n('UD C082 zero-based element2',wire,'UD',2,'199001011234:SE2:260'),
  n('IT C082 zero-based element2',wire,'IT',2,'735123456789508946::9'),
  n('UD name element4',wire,'UD',4,'Original Name'),n('UD street element5',wire,'UD',5,'Original Street'),
  n('UD city element6',wire,'UD',6,'Original City'),n('UD postcode element8',wire,'UD',8,'12345'),
  n('UD country element9',wire,'UD',9,'SE'),n('IT street element5',wire,'IT',5,'Site Street'),
  n('IT city element6',wire,'IT',6,'Site City'),n('IT postcode element8',wire,'IT',8,'54321'),
  n('IT country element9',wire,'IT',9,'SE'),n('existing empty element3',wire,'UD',3,null),
  n('empty physical value',"NAD+UD++'",'UD',2,null),n('missing NAD element2',"RFF+LI:A'",'UD',2,null),
  n('null NAD raw',null,'UD',2,null),n('empty NAD raw','','UD',2,null),n('null qualifier',wire,null,2,null),
  n('empty qualifier',wire,'',2,null),n('negative index',wire,'UD',-1,null),n('null index',wire,'UD',null,null),
  n('out of range index',wire,'UD',100,null),n('max integer index fails closed',wire,'UD',2147483647,null),
  n('literal qualifier not wildcard',"NAD+UXD+VALUE'",'U.D',2,null),
  n('qualifier regex injection refused',wire,'UD|IT',2,null),
  n('legacy no-match element0 compatibility',"RFF+LI:A'",'UD',0,'NAD'),
  n('legacy no-match element1 compatibility',"RFF+LI:A'",'UD',1,'UD')];
for (const qualifier of ['Z.4','Z+4','Z[4]','Z(4)','Z|4','Z$4','Z^4','Z\\4']) {
  cases.push(c(`declared synthetic literal descriptor ${qualifier}`,`CCI++${qualifier}'CAV+LITERAL'`,qualifier,'LITERAL'));
}
for (const qualifier of ['U.D','U[ D]','U(D)','U|D','U\\D']) {
  cases.push(n(`declared synthetic literal NAD qualifier ${qualifier}`,`NAD+${qualifier}+VALUE'`,qualifier,2,'VALUE'));
}
const metadata = `SELECT oid::text,proowner::text,proacl::text,provolatile,prosecdef,proisstrict,proparallel,proleakproof,proconfig
 FROM pg_proc WHERE oid IN ('public.gridex_edifact_cci_cav_value(text,text)'::regprocedure,
 'public.gridex_edifact_nad_element(text,text,integer)'::regprocedure) ORDER BY proname`;
const snapshot = async db => (await db.query('SELECT jsonb_agg(to_jsonb(s) ORDER BY id) state FROM public.scalar_sentinel s')).rows[0].state;
test(`finite scalar ${proposed ? 'isolated proposed-forward' : 'immutable old SQL RED'} (not native or authority)`, async t => {
 for (const created of ['on','off']) for (const called of ['on','off']) {
  const db = new PGlite();
  try {
   await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE public.scalar_sentinel(id integer PRIMARY KEY, facts text); INSERT INTO public.scalar_sentinel VALUES(1,'SYNTHETIC_UNCHANGED');
    SET standard_conforming_strings=${created};`);
   await db.exec(original);
   const originalMetadata = (await db.query(metadata)).rows;
   if (proposed) await db.exec(proposed);
   await t.test(`create=${created} call=${called} identity/ACL/immutable-invoker metadata`,async()=>{
    assert.deepEqual((await db.query(metadata)).rows,originalMetadata);
    assert.equal(originalMetadata.length,2);
    for (const f of originalMetadata) {assert.equal(f.provolatile,'i'); assert.equal(f.prosecdef,false);}
    for (const role of ['anon','authenticated']) for (const signature of [
      'public.gridex_edifact_cci_cav_value(text,text)','public.gridex_edifact_nad_element(text,text,integer)']) {
      assert.equal((await db.query("SELECT has_function_privilege($1,$2,'EXECUTE') allowed",[role,signature])).rows[0].allowed,false);
    }
   });
   await db.exec(`SET standard_conforming_strings=${called};`);
   const before = await snapshot(db);
   for (const row of cases) await t.test(`create=${created} call=${called} ${row.name}`,async()=>{
    await db.exec('SET ROLE service_role');
    try {assert.equal((await db.query(row.query,row.values)).rows[0].value,row.expected);}
    finally {await db.exec('RESET ROLE');}
    assert.deepEqual(await snapshot(db),before,'scalar evaluation may not mutate synthetic sentinel');
   });
   await t.test(`create=${created} call=${called} anon/auth cannot execute`,async()=>{
    for (const role of ['anon','authenticated']) {
     await db.exec(`SET ROLE ${role}`);
     try {await assert.rejects(()=>db.query(cases[0].query,cases[0].values),{code:'42501'});}
     finally {await db.exec('RESET ROLE');}
    }
    assert.deepEqual(await snapshot(db),before);
   });
  } finally {await db.close();}
 }
});

}

// Additive correlation refusal regression. Public rows below are declared synthetic SQL I/O.
// Full captured facility table and all fiveFKs are retained; other tables are minimal inputs.
// No authoritative message producer, private accepted facts, full-schema/native/whole proof.
{
const repoSql = file => readFileSync(path.join(__dirname,'../supabase/migrations',file),'utf8');
const functionSql = (file,name) => {
 const source=repoSql(file),marker=`create or replace function public.${name}(`;
 const start=source.indexOf(marker),end=source.indexOf('$$;',start);
 assert.ok(start>=0&&end>start,`actual immutable function ${name} must exist`);
 return source.slice(start,end+3);
};
const correlationDdl=repoSql('20260821142000_typed_z02_operation_job_correlation_gate.sql');
const correlationTrigger=correlationDdl.match(/create trigger trg_customer_operation_job_z02_correlation[\s\S]*?\(\);/);
assert.ok(correlationTrigger,'actual immutable correlation trigger must exist');
const chain=[
 functionSql('20260821142000_typed_z02_operation_job_correlation_gate.sql','gridex_prodat_variant_from_raw'),
 functionSql('20260821142500_typed_z02_rff_extractor_hotfix.sql','gridex_edifact_rff_value'),
 functionSql('20260821145500_atomic_correlated_z02_core_apply.sql','gridex_edifact_first_lin_item_id'),
 repoSql('20260821165300_prodat_identity_and_z02_li_compliance.sql'),
 correlationTrigger[0],
 repoSql('20260903070000_harden_inbound_z02_required_payload_gate.sql')
].join('\n\n');
const forward=repoSql('20261007074502_received_z02_payload_scalar_readers.sql');
let candidate=null;
try{candidate=repoSql('20261007085618_received_z02_blocking_correlation_issue.sql');}
catch(error){if(error.code!=='ENOENT')throw error;}
// A missing future forward runs the actual legacy SQL and fails at its real23514 INSERT.
const schema=readFileSync(path.join(__dirname,'../supabase/schema.sql'),'utf8');
const facilityTable=schema.match(/CREATE TABLE public\.facility_data_quality_issues \([\s\S]*?\n\);/);
const facilityConstraints=[...schema.matchAll(/ALTER TABLE ONLY public\.facility_data_quality_issues\n    ADD CONSTRAINT facility_data_quality_issues[^;]+;/g)].map(m=>m[0]);
assert.ok(facilityTable,'captured actual facility table must exist');
assert.equal(facilityConstraints.length,6,'actual PK and fiveFKs must be present');
const fullFacility=facilityTable[0]+'\n'+facilityConstraints.join('\n');
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ids = { company:uuid(1),customer:uuid(2),site:uuid(3),request:uuid(4),source:uuid(5),inbound:uuid(6),job:uuid(7),foreign:uuid(8),wrongCustomer:uuid(9) };
// Only referenced columns are declared. Full captured schema/FKs/other triggers are NOT installed.
// The actual captured facility status/severity checks are retained, including rejection of 'critical'.
const tables = `
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE public.companies(id uuid PRIMARY KEY);
CREATE TABLE public.customers(id uuid PRIMARY KEY,company_id uuid NOT NULL,org_number text,personal_number text,UNIQUE(id,company_id));
CREATE TABLE public.customer_sites(id uuid PRIMARY KEY,company_id uuid NOT NULL,customer_id uuid NOT NULL,normalized_facility_id text,facility_id text,street text,postal_code text,city text,country text);
CREATE TABLE public.customer_info_requests(id uuid PRIMARY KEY,company_id uuid NOT NULL,customer_id uuid NOT NULL,site_id uuid,grid_owner_id uuid,ediel_message_id uuid,grid_owner_data_request_id uuid,status text NOT NULL,blocker_code text,blocker_reason text,blocker_details jsonb,next_required_action text,updated_at timestamptz NOT NULL);
CREATE TABLE public.ediel_messages(id uuid PRIMARY KEY,company_id uuid NOT NULL,direction text,message_family text,message_code text,customer_id uuid,site_id uuid,grid_owner_id uuid,grid_owner_data_request_id uuid,status text,created_at timestamptz,sender_ediel_id text,receiver_ediel_id text,raw_payload text,parsed_payload jsonb,validation_report jsonb);
CREATE TABLE public.ediel_business_references(id uuid PRIMARY KEY,company_id uuid NOT NULL,source_message_id uuid,message_family text,message_code text,reference_type text,reference_value text);
CREATE TABLE public.customer_operation_jobs(id uuid PRIMARY KEY,company_id uuid NOT NULL,customer_id uuid NOT NULL,customer_site_id uuid,job_type text NOT NULL,status text NOT NULL CHECK(status IN ('queued','running','waiting_response','completed','needs_review','failed','skipped','cancelled')),payload jsonb NOT NULL,result jsonb NOT NULL);
CREATE TABLE public.metering_points(id uuid PRIMARY KEY,company_id uuid NOT NULL,customer_site_id uuid,synthetic_sentinel jsonb NOT NULL);
`;
const ud = ['NAD','UD','199001011234:SE2:260','','Original Name','Original Street','Original City','','12345','SE'];
const it = ['NAD','IT','735123456789508946::9','','Site Name','Site Street','Site City','','54321','SE'];
function raw({reason='Z22',method=true,udValues=ud,itValues=it}={}) {
  return ["LIN+1++735123456789508946",'RFF+LI:OWN-LI','RFF+Z05:AAA',...(method?['CCI++Z04','CAV+Z04']:[]),...(reason?['CCI++Z13',`CAV+${reason}`]:[]),udValues.join('+'),itValues.join('+')].join("'")+"'";
}
const mutate = (values,index,value) => values.map((v,i)=>i===index?value:v);
const cases = [
 {name:'physical L complete',input:{},reason:null},
 {name:'physical LK complete',input:{reason:'Z23'},reason:null},
 {name:'missing method 217',input:{method:false},reason:'z02_required_measure_method_missing'},
 {name:'missing reason 223',input:{reason:null},reason:'z02_required_reason_missing'},
 {name:'UD wrong identity',input:{udValues:mutate(ud,2,'199001011235:SE2:260')},reason:'z02_end_user_identity_conflict'},
 {name:'UD wrong qualifier',input:{udValues:mutate(ud,2,'199001011234:SE1:260')},reason:'z02_end_user_qualifier_conflict'},
 ...[4,6,8,9].map(index=>({name:`UD omitted index ${index}`,input:{udValues:mutate(ud,index,'')},reason:'z02_required_end_user_fields_missing'})),
 {name:'IT omitted street index 5',input:{itValues:mutate(it,5,'')},reason:'z02_required_installation_fields_missing'},
 {name:'IT wrong ID index 2',input:{itValues:mutate(it,2,'735123456789508947::9')},reason:'z02_installation_id_line_item_mismatch'},
 {name:'IT wrong street index 5',input:{itValues:mutate(it,5,'Wrong Street')},reason:'z02_installation_address_conflict'},
 {name:'IT wrong city index 6',input:{itValues:mutate(it,6,'Wrong City')},reason:'z02_installation_city_conflict'},
 {name:'IT wrong postcode index 8',input:{itValues:mutate(it,8,'54322')},reason:'z02_installation_postcode_conflict'},
 {name:'IT wrong country index 9',input:{itValues:mutate(it,9,'NO')},reason:'z02_installation_country_conflict'},
 {name:'completed stage bypasses both gates',input:{},status:'completed',reason:null,bypass:true},
 {name:'different job type bypasses both gates',input:{},jobType:'synthetic_other_job',reason:null,bypass:true},
 {name:'existing wrong job customer persists scoped mismatch refusal',input:{},wrongCustomer:true},
];

const stableTables=['customers','customer_sites','ediel_messages','ediel_business_references','metering_points'];
const snapshot=async(db,t)=>JSON.stringify((await db.query(`SELECT to_jsonb(t) AS row FROM public.${t} t ORDER BY id`)).rows);
test(`finite correlation refusal ${candidate ? 'forward' : 'legacy SQL RED'} (synthetic public inputs; not native or authority)`,async t=>{
 for (const c of cases) await t.test(c.name,async()=>{
  const fixed=Boolean(candidate);
  const db=new PGlite();
  const record={initial_result:{}};
  try {
    await db.exec('SET standard_conforming_strings=on;'+tables+fullFacility+chain+forward);
    const procMeta=async()=> (await db.query("SELECT oid::text,proowner::text,proacl::text,prosecdef,provolatile,proconfig,pg_get_function_identity_arguments(oid) AS args FROM pg_proc WHERE oid='public.gridex_gate_inbound_z02_operation_job()'::regprocedure")).rows[0];
    const beforeProc=await procMeta();if(fixed)await db.exec(candidate);const afterProc=await procMeta();assert.deepEqual(afterProc,beforeProc);record.correlation_oid_acl_owner_security_metadata_preserved=true;record.correlation_metadata=afterProc;
    await db.query('INSERT INTO companies VALUES($1),($2)',[ids.company,ids.foreign]);
    await db.query('INSERT INTO customers VALUES($1,$2,NULL,$3)',[ids.wrongCustomer,ids.company,'199001011235']);
    await db.query('INSERT INTO customers VALUES($1,$2,NULL,$3)',[ids.customer,ids.company,'199001011234']);
    await db.query('INSERT INTO customer_sites VALUES($1,$2,$3,$4,$4,$5,$6,$7,$8)',[ids.site,ids.company,ids.customer,'735123456789508946','Site Street','54321','Site City','SE']);
    await db.query('INSERT INTO metering_points VALUES($1,$2,$3,$4)',[uuid(10),ids.company,ids.site,{preserved:'synthetic meter facts'}]);
    for(const [id,direction,code,sender,receiver,wire] of [[ids.source,'outbound','Z01','SUPPLIER','OWNER',raw({reason:c.input.reason??'Z22'})],[ids.inbound,'inbound','Z02','OWNER','SUPPLIER',raw(c.input)]]) {
      await db.query("INSERT INTO ediel_messages VALUES($1,$2,$3,'PRODAT',$4,$5,$6,NULL,NULL,'received','2026-01-01',$7,$8,$9,'{}','{}')",[id,ids.company,direction,code,ids.customer,ids.site,sender,receiver,wire]);
    }
    await db.query("INSERT INTO customer_info_requests VALUES($1,$2,$3,$4,NULL,$5,NULL,'waiting_for_z02',NULL,NULL,'{}',NULL,'2026-01-01')",[ids.request,ids.company,ids.customer,ids.site,ids.source]);
    await db.query("INSERT INTO customer_info_requests VALUES($1,$2,$3,$4,NULL,$5,NULL,'waiting_for_z02',NULL,NULL,'{}',NULL,'2026-01-01')",[uuid(11),ids.foreign,ids.customer,ids.site,ids.source]);
    // The declared public reference index is derived through the actual SQL RFF extractor.
    await db.query("INSERT INTO ediel_business_references SELECT $1,$2,id,'PRODAT','Z01','RFF_LI',public.gridex_edifact_rff_value(raw_payload,'LI') FROM ediel_messages WHERE id=$3",[uuid(12),ids.company,ids.source]);
    record.actual_helper_read=(await db.query("SELECT public.gridex_prodat_variant_from_raw($1) AS variant,public.gridex_edifact_rff_value($1,'LI') AS li,public.gridex_edifact_cci_cav_value($1,'Z04') AS method,public.gridex_edifact_cci_cav_value($1,'Z13') AS reason",[raw(c.input)])).rows[0];
    assert.equal(record.actual_helper_read.li,'OWN-LI');
    const before=Object.fromEntries(await Promise.all([...stableTables,'customer_info_requests','facility_data_quality_issues'].map(async t=>[t,await snapshot(db,t)])));
    // Actual INSERT is the target operation. Legacy23514 is an undesired failed refusal, not an expected GREEN oracle.
    await db.query('INSERT INTO customer_operation_jobs VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[ids.job,ids.company,c.wrongCustomer?ids.wrongCustomer:ids.customer,ids.site,c.jobType??'apply_inbound_grid_owner_response',c.status??'queued',{customer_info_request_id:ids.request,ediel_message_id:ids.inbound},{}]);
    for(const t of stableTables)assert.equal(await snapshot(db,t),before[t],`${t} changed`);
    const requests=(await db.query('SELECT * FROM customer_info_requests ORDER BY id')).rows;
    const job=(await db.query('SELECT * FROM customer_operation_jobs')).rows[0];
    record.job=job??null;record.requests=requests;record.asset_and_message_tables_unchanged=true;
    if(c.bypass){assert.equal(job.status,c.status??'queued');assert.deepEqual(job.result,{});assert.equal(await snapshot(db,'customer_info_requests'),before.customer_info_requests);}
    else {
      if(!c.wrongCustomer){assert.equal(job.result.z02_correlation_status,'exact','not produced by real correlation trigger');assert.equal(job.result.correlation.exact_li_match,true);assert.equal(job.result.correlation.source_li_registry_matches,1);}
      else {assert.equal(job.result.z02_correlation_status,undefined);assert.equal(job.result.z02_payload_validation,undefined);}
      const expected=c.wrongCustomer?'request_site_customer_mismatch':c.reason;
      assert.equal(job.result.reason_code??null,expected);assert.equal(job.status,expected?'needs_review':'queued');
      const own=requests.find(r=>r.id===ids.request),foreign=requests.find(r=>r.id===uuid(11));
      assert.equal(foreign.status,'waiting_for_z02');assert.equal(foreign.blocker_code,null);
      if(expected){assert.equal(own.status,'manual_review_required');assert.equal(own.blocker_code,expected);if(!c.wrongCustomer)assert.equal(own.blocker_details.z02_payload_validation.gate,'gridex_gate_inbound_z02_required_payload');}
      else{assert.equal(job.result.z02_payload_validation_status,'valid');assert.equal(job.result.z02_payload_validation.measure_method,'Z04');assert.equal(job.result.z02_payload_validation.reason_for_transaction,c.input.reason??'Z22');assert.equal(await snapshot(db,'customer_info_requests'),before.customer_info_requests);}
      if(!c.wrongCustomer)assert.equal(await snapshot(db,'facility_data_quality_issues'),before.facility_data_quality_issues);
      else {
        const issue=(await db.query('SELECT * FROM facility_data_quality_issues')).rows;assert.equal(issue.length,1);assert.equal(issue[0].severity,'blocking');assert.equal(issue[0].source_error_code,expected);assert.equal(issue[0].company_id,ids.company);assert.equal(issue[0].customer_id,ids.wrongCustomer);assert.equal(issue[0].customer_site_id,ids.site);assert.equal(issue[0].retry_allowed,false);assert.equal(issue[0].next_readiness_required,true);record.real_issue=issue[0];
        await db.query("UPDATE customer_operation_jobs SET status='queued' WHERE id=$1",[ids.job]);assert.equal((await db.query('SELECT count(*)::int AS n FROM facility_data_quality_issues')).rows[0].n,1);record.real_update_replay_deduplicated=true;
        for(const t of stableTables)assert.equal(await snapshot(db,t),before[t],`${t} changed after retry`);
      }
    }
  } finally {await db.close();}
 });
});
}
