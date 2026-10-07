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
const migration = path.join(__dirname, '../supabase/migrations/20261007050001_received_z02_address_source_basis.sql')
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
