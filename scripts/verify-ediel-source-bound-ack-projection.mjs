// PROSPECTIVE RUNNER SOURCE. ROOT executes it; this reviewer has not run it.
// Synthetic journals and permission/expectation/source-owner ports are declared
// fixtures. Real captured accepted basis, wire parser and full projector execute.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {pathToFileURL} from 'node:url'

const hash = value => createHash('sha256').update(value).digest('hex')
const args = process.argv.slice(2), options = {}
for(let at=0;at<args.length;at++) {
  const key=args[at]
  if(key==='--allow-pre-schema') { options.allowPreSchema=true; continue }
  if(!['--schema','--pre-schema','--migration'].includes(key) || at+1>=args.length) throw Error('Expected --schema PATH --pre-schema PATH --migration PATH [--allow-pre-schema]')
  options[key.slice(2)]=args[++at]
}
const schemaPath=options.schema||process.env.EDIEL_SCHEMA_PATH
const preSchemaPath=options['pre-schema']||process.env.EDIEL_PRE_SCHEMA_PATH
const migrationPath=options.migration||process.env.EDIEL_MIGRATION_PATH
if(!schemaPath||!preSchemaPath||!migrationPath) throw Error('Actual schema, pre-schema and migration paths required')
if(!process.env.EDIEL_PGLITE_MODULE) throw Error('EDIEL_PGLITE_MODULE required')
const schema=readFileSync(schemaPath,'utf8'),preSchema=readFileSync(preSchemaPath,'utf8'),forward=readFileSync(migrationPath,'utf8')
assert.equal(hash(preSchema),'d9b58b4a7998284aa38d3997311f1bd26706aaa5b4356d53fc30a49f12a8d707','exact genuine before-schema required')
function definition(source,name) {
  const prefix=' FUNCTION '+name+'('
  const marker=source.indexOf(prefix)
  assert.ok(marker>=0,'actual definition missing '+name)
  let at=source.lastIndexOf('CREATE',marker)
  assert.ok(at>=0)
  const tail=source.slice(at)
  const found=/^\s+AS (\$[^$]*\$)/m.exec(tail)
  assert.ok(found,'actual dollar body missing '+name)
  const bodyAt=found.index+found[0].length
  const close=tail.indexOf(found[1]+';',bodyAt)
  assert.ok(close>=bodyAt)
  return {sql:tail.slice(0,close+found[1].length+1)+'\n',body:tail.slice(bodyAt,close)}
}
const functionHashes={
  'gridex_utilts_binding.wire_tokens_v1':'3afa82bc9017cfc40ad69692d6cb9ead7e510da529ae496d0802d170e4f43c7b',
  'gridex_ack_authority.wire_v1':'ece780d4462b548f0091f92f36cda35e7feb67face0af462325e7a4e039a385f',
  'gridex_ediel_transport.accepted_source_basis_v1':'97cc77b308e73b1689c1124774520f3bbd013d166a5b50d44c41ac1286644c5f',
  'public.ediel_project_accepted_source_state_v1':'b1cbb059d9c4200ccd15d2782941840e36c9121d1d8a1c90c6b5f629c8898283',
  'public.gridex_ediel_accepted_transport_projection_v1':'b4d1e40dc53d3de58dae379090dad717cf810859e0cbe0998900239821ee50d7',
  'gridex_ediel_transport.repair_message_projection_v1':'afbb93b1ed9c1fe7540af51312b8e781b1be55f9b07d94716ad4bc14dfcd8904',
  'gridex_ediel_transport.repair_before_method_watch_v1':'c4632362b3f223641b0df6d9e391b140287976f75c438e2bc1fec270f96afc78',
  'public.gridex_ediel_repair_accepted_transport_projection_v1':'8a38aefcc3bc4b2fe893f9ad74041b1e2420b441180e5e27c250528d55fe5db0'
}
const projectionName='public.ediel_project_accepted_source_state_v1'
const originalProjection=definition(preSchema,projectionName)
const migrationProjection=definition(forward,projectionName)
const currentProjection=definition(schema,projectionName)
assert.equal(migrationProjection.sql.replace('CREATE OR REPLACE FUNCTION ','CREATE FUNCTION ').replace(migrationProjection.body,()=>originalProjection.body),originalProjection.sql,'all migration function properties/signature unchanged')
assert.equal(currentProjection.sql.replace(currentProjection.body,()=>originalProjection.body),originalProjection.sql,'all actual schema function properties/signature unchanged')
assert.equal(hash(originalProjection.body),'01a18718d1d55c93238f2f9a8cfcb44da7cd5b35dbee96af964066a1848b7379')
assert.equal(hash(migrationProjection.body),'66d86e98130ca6f5e64ae966d710f35bce86204452febe714684025943a81f17','reviewed full postimage required')
let sourceMode='actual_postimage'
if(currentProjection.body!==migrationProjection.body) {
  assert.ok(options.allowPreSchema,'actual current schema must contain the reviewed postimage; --allow-pre-schema permits only prospective pre-adoption execution')
  assert.equal(currentProjection.body,originalProjection.body)
  assert.equal(hash(schema),hash(preSchema))
  sourceMode='prospective_preimage_plus_actual_forward'
}
const beforeFunctions=[],actualFunctionHashes={}
for(const [name,expected] of Object.entries(functionHashes)) {
  const before=definition(preSchema,name),actual=definition(schema,name)
  assert.equal(hash(before.sql),expected,'whole genuine before function '+name)
  if(name===projectionName) beforeFunctions.push(sourceMode==='actual_postimage'?actual.sql:before.sql)
  else {
    assert.equal(hash(actual.sql),expected,'whole actual postimage unchanged helper/wrapper '+name)
    beforeFunctions.push(actual.sql)
  }
  actualFunctionHashes[name]=hash(actual.sql)
}
const bundle=beforeFunctions.join('\n')
const actualWireAuthority=definition(schema,'gridex_ack_authority.wire_v1').sql
const aclAt=preSchema.indexOf('REVOKE ALL ON FUNCTION '+projectionName+'(')
const grantAt=preSchema.indexOf('GRANT ALL ON FUNCTION '+projectionName+'(',aclAt)
assert.ok(aclAt>=0&&grantAt>aclAt)
const capturedAcl=preSchema.slice(aclAt,preSchema.indexOf('\n',grantAt)+1)
assert.equal(hash(capturedAcl),'b1d55744b03f3f26dd4d33817cd3751f41a2a410dc34bb8aa45e044b0ef9d52e')
const actualAclAt=schema.indexOf('REVOKE ALL ON FUNCTION '+projectionName+'(')
const actualGrantAt=schema.indexOf('GRANT ALL ON FUNCTION '+projectionName+'(',actualAclAt)
assert.ok(actualAclAt>=0&&actualGrantAt>actualAclAt)
assert.equal(schema.slice(actualAclAt,schema.indexOf('\n',actualGrantAt)+1),capturedAcl,'whole actual captured source projection ACL unchanged')
const {PGlite}=await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href)
const db=new PGlite()
const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0')
const company = id(1), actor = id(2), customer = id(3), site = id(4), point = id(5)
const originalId = id(6), outboundId = id(7), dataId = id(8)
const originalClock = '2026-10-08T08:00:00+00:00'
const clock1 = '2026-10-09T12:00:01+00:00', clock2 = '2026-10-09T12:00:02+00:00'
const recipient = 'synthetic-recipient@example.invalid'
let checks = 0
const result = {scope:'finite_actual_function_behavior_with_synthetic_ports_not_native',
  verifiedContractBase:'a00e30d54c2ef39167c9ba96a207008c780db903', sourceMode,
  schemaSha256:hash(schema),preSchemaSha256:hash(preSchema),migrationSha256:hash(forward),actualFunctionHashes,
  beforeBugReproductions:[], afterControls:[]}
const passed = label => { checks++; result.afterControls.push(label) }

function wire(family, code = family, maliciousReleasedText = false) {
  const control = 'SYNTHETIC' + family
  const segments = [
    ['UNB','UNOC:3','1111111:14','2222222:14','261009:1200',control,'','EL','','','','1'].join('+'),
    ['UNH','MSG1',family + (family === 'CONTRL' ? ':2:2:UN:EDIEL2' : ':D:96A:UN:E2SE6A')].join('+'),
    ['BGM',code,'SYNTHETIC-DOCUMENT','9'].join('+')
  ]
  if (maliciousReleasedText) segments.push('FTX+AAI+++UNH?+SPOOF?+APERAK')
  const count = segments.length // UNH..BGM/FTX plus final UNT
  segments.push('UNT+' + count + '+MSG1', 'UNZ+1+' + control)
  return "UNA:+.? '" + segments.join("'") + "'"
}

async function rows(table) {
  return (await db.query('SELECT to_jsonb(t) value FROM public.' + table + ' t ORDER BY id')).rows.map(r => r.value)
}
async function snapshotAll() {
  return {messages:await rows('ediel_messages'),outbound:await rows('outbound_requests'),data:await rows('grid_owner_data_requests'),info:await rows('customer_info_requests')}
}
async function ancestors() {
  return {outbound:await rows('outbound_requests'),data:await rows('grid_owner_data_requests'),info:await rows('customer_info_requests'),
    original:(await db.query('SELECT to_jsonb(m) value FROM public.ediel_messages m WHERE id=$1',[originalId])).rows[0].value}
}
async function seedBase() {
  await db.exec('TRUNCATE public.ediel_messages,public.outbound_requests,public.grid_owner_data_requests,public.customer_info_requests,gridex_ediel_transport.attempts')
  await db.query('INSERT INTO public.outbound_requests VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
    [outboundId,company,customer,site,point,'completed',originalClock,'KEEP-ORIGINAL-FAILURE',id(99),originalClock])
  await db.query('INSERT INTO public.grid_owner_data_requests VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
    [dataId,company,customer,site,point,'received',originalClock,originalClock,'KEEP-ORIGINAL-DATA-FAILURE',id(99),originalClock])
  await db.query('INSERT INTO public.customer_info_requests(id,company_id,status,sent_at,blocker_code,next_required_action) VALUES($1,$2,$3,$4,$5,$6)',
    [id(9),company,'z02_received',originalClock,'KEEP-ORIGINAL-BLOCKER','KEEP-ORIGINAL-ACTION'])
  await db.query('INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,status,message_sent_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [originalId,company,'test','inbound','edifact','PRODAT','Z04','completed',originalClock])
}
async function seedMessage({n=10,family='APERAK',physical=family,code=family,standard='edifact',related=originalId,mismatch=false,observed=clock1,links='both',rawOverride,maliciousReleasedText=false}={}) {
  const mid=id(n),raw=rawOverride??wire(physical,code,maliciousReleasedText),h=hash(raw)
  const request=links==='data'?null:outboundId,data=links==='outbound'?null:dataId
  await db.query('INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,related_message_id,raw_payload,immutable_payload_hash,immutable_rendered_at,customer_id,site_id,metering_point_id,outbound_request_id,grid_owner_data_request_id,status,processing_status,requires_contrl,contrl_status,ack_due_at,contrl_due_at,updated_by,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)',
    [mid,company,'test','outbound',standard,family,code,related,raw,h,originalClock,mismatch?null:customer,site,point,request,data,'dispatching','dispatching',false,'not_required',null,null,id(99),originalClock])
  const binding={originalHash:h,to:recipient,businessExpectationPlan:null}
  const provider={accepted:[recipient],rejected:[],messageId:'<SYNTHETIC-'+n+'@example.invalid>',response:'SYNTHETIC 250'}
  await db.query('INSERT INTO gridex_ediel_transport.attempts VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [id(1000+n),mid,company,'test',binding,provider,'accepted',originalClock,observed])
  return {mid,raw,h,observed,attempt:id(1000+n)}
}
async function project(m,{scope=company,executor=actor,expected=m.h,environment='test',repair=false}={}) {
  await db.exec('SET ROLE service_role')
  try {
    const sql=repair?'SELECT public.gridex_ediel_repair_accepted_transport_projection_v1($1,$2,$3,$4) value':'SELECT public.ediel_project_accepted_source_state_v1($1,$2,$3,$4,$5) value'
    const args=repair?[scope,environment,executor,m.mid]:[scope,environment,executor,m.mid,expected]
    return (await db.query(sql,args)).rows[0].value
  } finally { await db.exec('RESET ROLE') }
}
async function rejectsWithoutEffects(m,pattern,options={}) {
  const before=await snapshotAll()
  await assert.rejects(project(m,options),pattern)
  assert.deepEqual(await snapshotAll(),before)
}

try {
  await db.exec([
    'CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;',
    'CREATE TABLE public.user_profiles(id uuid PRIMARY KEY,user_status text);',
    'CREATE TABLE public.company_memberships(id uuid PRIMARY KEY,company_id uuid,user_id uuid,status text,is_active boolean,accepted_at timestamptz);',
    'CREATE TABLE public.fixture_permissions(company_id uuid,user_id uuid,permission text,allowed boolean);',
    "CREATE FUNCTION public.gridex_actor_has_company_permission(u uuid,c uuid,p text) RETURNS boolean LANGUAGE sql AS $$SELECT coalesce((SELECT allowed FROM public.fixture_permissions WHERE company_id=c AND user_id=u AND permission=p),false)$$;",
    'CREATE TABLE public.ediel_messages(id uuid PRIMARY KEY,company_id uuid,environment text,direction text,message_standard text,message_family text,message_code text,related_message_id uuid,raw_payload text,immutable_payload_hash text,immutable_rendered_at timestamptz,customer_id uuid,site_id uuid,metering_point_id uuid,outbound_request_id uuid,grid_owner_data_request_id uuid,status text,processing_status text,requires_contrl boolean,contrl_status text,ack_due_at timestamptz,contrl_due_at timestamptz,business_response_due_at timestamptz,message_sent_at timestamptz,updated_by uuid,updated_at timestamptz);',
    'CREATE TABLE public.outbound_requests(id uuid PRIMARY KEY,company_id uuid,customer_id uuid,site_id uuid,metering_point_id uuid,status text,sent_at timestamptz,failure_reason text,updated_by uuid,updated_at timestamptz);',
    'CREATE TABLE public.grid_owner_data_requests(id uuid PRIMARY KEY,company_id uuid,customer_id uuid,site_id uuid,metering_point_id uuid,status text,sent_at timestamptz,failed_at timestamptz,failure_reason text,updated_by uuid,updated_at timestamptz);',
    "CREATE TABLE public.customer_info_requests(id uuid PRIMARY KEY,company_id uuid,customer_id uuid,site_id uuid,metering_point_id uuid,ediel_message_id uuid,outbound_request_id uuid,grid_owner_data_request_id uuid,status text,sent_at timestamptz,blocker_code text,blocker_reason text,blocker_details jsonb DEFAULT '{}'::jsonb,next_required_action text,updated_by uuid,updated_at timestamptz);",
    'CREATE SCHEMA gridex_utilts_binding; CREATE SCHEMA gridex_ack_authority; CREATE SCHEMA gridex_ediel_transport; CREATE SCHEMA gridex_outbound_dispatch;',
    'CREATE TABLE gridex_ediel_transport.attempts(id uuid PRIMARY KEY,message_id uuid,company_id uuid,environment text,binding jsonb,provider_result jsonb,classification text,entered_at timestamptz,observed_at timestamptz);',
    'CREATE TABLE gridex_outbound_dispatch.attempts(id uuid,message_id uuid,company_id uuid,environment text,binding jsonb); CREATE TABLE gridex_outbound_dispatch.originals(message_id uuid,company_id uuid,environment text,payload_hash text,raw_payload text); CREATE TABLE gridex_outbound_dispatch.events(id uuid,attempt_id uuid,message_id uuid,company_id uuid,environment text,kind text,facts jsonb,observed_at timestamptz);',
    'CREATE SCHEMA gridex_business_expectations; CREATE SCHEMA gridex_method_expectations; CREATE SCHEMA gridex_supply_rescission;',
    "CREATE FUNCTION gridex_business_expectations.mutate_v1(jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'fixture_unexpected_business_expectation_port'; END$$;",
    "CREATE FUNCTION gridex_method_expectations.mutate_v1(jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'fixture_unexpected_method_expectation_port'; END$$;",
    'CREATE FUNCTION gridex_supply_rescission.outbound_required_v1(text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$SELECT false$$;',
    'CREATE FUNCTION gridex_supply_rescission.sender_v1(uuid,uuid) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;',
    "CREATE FUNCTION gridex_ediel_transport.require_technical_expectation_plan_v1(public.ediel_messages,jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'fixture_unexpected_technical_expectation_port'; END$$;"
  ].join('\n'))
  await db.query('INSERT INTO public.user_profiles VALUES($1,$2)',[actor,'active'])
  await db.query('INSERT INTO public.company_memberships VALUES($1,$2,$3,$4,$5,$6)',[id(90),company,actor,'active',true,originalClock])
  await db.query('INSERT INTO public.fixture_permissions VALUES($1,$2,$3,$4)',[company,actor,'communication.send',true])
  await db.exec(bundle)
  await db.exec(capturedAcl)
  for (const signature of ['public.gridex_ediel_repair_accepted_transport_projection_v1(uuid,text,uuid,uuid)','public.gridex_ediel_accepted_transport_projection_v1(uuid,text,uuid,uuid)']) {
    await db.exec('REVOKE ALL ON FUNCTION '+signature+' FROM PUBLIC,anon,authenticated; GRANT EXECUTE ON FUNCTION '+signature+' TO service_role;')
  }
  const actualProsrc=async()=>(await db.query("SELECT prosrc FROM pg_proc WHERE oid='public.ediel_project_accepted_source_state_v1(uuid,text,uuid,uuid,text)'::regprocedure")).rows[0].prosrc
  if(sourceMode==='actual_postimage') {
    assert.equal(await actualProsrc(),currentProjection.body)
    await seedBase()
    const capturedA=await seedMessage({n:10,family:'APERAK',mismatch:true,observed:clock1})
    const capturedB=await seedMessage({n:11,family:'CONTRL',mismatch:false,observed:clock2})
    const capturedAncestorPreimage=await ancestors()
    for(const own of [capturedA,capturedB,capturedA]) {
      const projection=await project(own,{repair:true})
      assert.equal(projection.status,'accepted_projection')
      assert.equal(projection.messageId,own.mid)
      assert.equal(projection.authorizesProviderEntry,false)
      assert.equal(projection.deliveryProven,false)
      assert.equal(Date.parse((await db.query('SELECT message_sent_at FROM public.ediel_messages WHERE id=$1',[own.mid])).rows[0].message_sent_at),Date.parse(own.observed))
      assert.deepEqual(await ancestors(),capturedAncestorPreimage)
    }
    result.directCapturedPostimage='EXECUTED_ACTUAL_INPUT_SCHEMA_FUNCTION_BEFORE_HISTORICAL_RESET'
    passed('actual newly captured complete projector and all actual unchanged helpers execute directly before historical RED/reset')
    await db.exec(originalProjection.sql.replace('CREATE FUNCTION ','CREATE OR REPLACE FUNCTION '))
  } else {
    result.directCapturedPostimage='NOT_RUN_PROSPECTIVE_PREIMAGE_ONLY'
  }
  assert.equal(await actualProsrc(),originalProjection.body)
  await seedBase()
  const beforeMatching=await seedMessage()
  const originalAncestors=await ancestors()
  await project(beforeMatching)
  const beforeChanged=await ancestors()
  assert.notDeepEqual(beforeChanged,originalAncestors)
  assert.equal(Date.parse(beforeChanged.outbound[0].sent_at),Date.parse(clock1))
  assert.equal(Date.parse(beforeChanged.data[0].sent_at),Date.parse(clock1))
  result.beforeBugReproductions.push('matched ACK overwrites BOTH ancestral request sent_at from its own receipt')
  await seedBase()
  const beforeMismatch=await seedMessage({mismatch:true})
  await rejectsWithoutEffects(beforeMismatch,/ediel_source_projection_owned_outbound_request_required/)
  result.beforeBugReproductions.push('partial ACK tuple refuses accepted projection atomically at owned_outbound_request guard')

  const signature='public.ediel_project_accepted_source_state_v1(uuid,text,uuid,uuid,text)'
  const catalog=async()=> (await db.query('SELECT to_jsonb(p) value FROM pg_catalog.pg_proc p WHERE p.oid=$1::regprocedure',[signature])).rows[0].value
  const withoutBody=value=>Object.fromEntries(Object.entries(value).filter(([key])=>key!=='prosrc'))
  const beforeCatalog=await catalog()
  await db.exec(forward)
  const afterCatalog=await catalog()
  assert.deepEqual(withoutBody(afterCatalog),withoutBody(beforeCatalog))
  passed('actual migration preserves full pg_proc metadata including OID, owner, ACL, signature and configuration')
  await db.exec(forward)
  assert.deepEqual(await catalog(),afterCatalog)
  passed('actual migration is idempotent on its reviewed postimage without catalog drift')
  for(const drift of ['body','metadata']) {
    if(drift==='body') await db.exec(migrationProjection.sql.replace(migrationProjection.body,()=> '\n-- declared unreviewed fixture body\n'+migrationProjection.body))
    else await db.exec('ALTER FUNCTION '+signature+' SECURITY INVOKER')
    const drifted=await catalog()
    await assert.rejects(()=>db.exec(forward),drift==='body'?/unreviewed_preimage/:/postimage_or_metadata_changed/)
    await db.exec('ROLLBACK')
    assert.deepEqual(await catalog(),drifted)
    await db.exec(migrationProjection.sql)
    assert.deepEqual(await catalog(),afterCatalog)
    passed('actual migration refuses '+drift+' drift atomically without overwriting the prior definition')
  }
  assert.equal(await actualProsrc(),migrationProjection.body)
  passed('exact final actual PostgreSQL prosrc matches reviewed full postimage')
  for (const [firstFamily,secondFamily] of [['APERAK','CONTRL'],['APERAK','APERAK']]) {
    for (const links of ['outbound','data','both']) {
      for (const mismatch of [false,true]) {
        await seedBase()
        const a=await seedMessage({n:10,family:firstFamily,observed:clock1,links,mismatch})
        const b=await seedMessage({n:11,family:secondFamily,observed:clock2,links,mismatch})
        const stable=await ancestors()
        for (const ack of [a,b,a,b]) {
          const projected=await project(ack,{repair:true})
          assert.equal(projected.status,'accepted_projection')
          assert.equal(projected.messageId,ack.mid)
          assert.equal(projected.authorizesProviderEntry,false)
          assert.equal(projected.deliveryProven,false)
          const own=(await db.query('SELECT message_sent_at,status FROM public.ediel_messages WHERE id=$1',[ack.mid])).rows[0]
          assert.equal(Date.parse(own.message_sent_at),Date.parse(ack.observed))
          assert.equal(own.status,'sent')
          assert.deepEqual(await ancestors(),stable)
        }
        passed('two same-source '+firstFamily+'/'+secondFamily+' '+links+' links partialTuple='+mismatch+' retain COMPLETE ancestor rows on both repairs/replays')
      }
    }
  }
  for (const family of ['PRODAT','UTILTS']) {
    await seedBase()
    const ordinary=await seedMessage({family,code:family==='PRODAT'?'Z02':'E31'})
    await project(ordinary)
    const advanced=await ancestors()
    assert.equal(Date.parse(advanced.outbound[0].sent_at),Date.parse(clock1))
    assert.equal(Date.parse(advanced.data[0].sent_at),Date.parse(clock1))
    assert.equal(advanced.outbound[0].failure_reason,'KEEP-ORIGINAL-FAILURE')
    assert.equal(advanced.outbound[0].status,'completed')
    assert.equal(advanced.data[0].status,'received')
    passed('ordinary '+family+' keeps real accepted request writeback and progressed failure/status')
  }
  const adverse=[
    {label:'orphan ACK',related:null},
    {label:'NULL standard',standard:null},
    {label:'non-EDIFACT',standard:'xml'},
    {label:'NULL family',family:null,physical:'APERAK',code:'APERAK'},
    {label:'unrelated family',family:'OTHER',physical:'PRODAT',code:'Z02'},
    {label:'UTILTS_ERR excluded',family:'UTILTS_ERR',physical:'UTILTS',code:'ERR'},
    {label:'PRODAT metadata relabelled APERAK',family:'APERAK',physical:'PRODAT',code:'Z02'},
    {label:'UTILTS metadata relabelled CONTRL',family:'CONTRL',physical:'UTILTS',code:'E31'},
    {label:'released fake APERAK text inside physical PRODAT',family:'APERAK',physical:'PRODAT',code:'Z02',maliciousReleasedText:true},
    {label:'row family differs from physical ACK family',family:'CONTRL',physical:'APERAK',code:'APERAK'},
    {label:'invalid framed ACK parser returns NULL',rawOverride:wire('APERAK').replace('UNT+3+MSG1','UNT+999+MSG1')},
    {label:'huge UNT count caught by actual wire parser',rawOverride:wire('APERAK').replace('UNT+3+MSG1','UNT+99999999999999999999999999+MSG1')},
    {label:'duplicate UNH frame refused by actual parser',rawOverride:wire('APERAK').replace("UNT+3+MSG1'","UNH+MSG1+APERAK:D:96A:UN:E2SE6A'UNT+4+MSG1'")},
    {label:'unterminated wire rejected by actual token parser',rawOverride:wire('APERAK').slice(0,-1)}
  ]
  for(const spec of adverse) {
    await seedBase()
    const m=await seedMessage({...spec,mismatch:true})
    await rejectsWithoutEffects(m,/ediel_source_projection_owned_outbound_request_required/)
    passed(spec.label+' cannot bypass unchanged business tuple guard/rollback')
  }
  await seedBase()
  const redirected=await seedMessage({related:id(99999),mismatch:true})
  const redirectedAncestors=await ancestors()
  await project(redirected)
  assert.deepEqual(await ancestors(),redirectedAncestors)
  passed('nonexistent mutable related pointer adds no ancestor write or business authority through this effect omission')
  await db.exec("CREATE OR REPLACE FUNCTION gridex_ack_authority.wire_v1(p_raw text) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path='pg_catalog' AS $$BEGIN RAISE EXCEPTION 'fixture_poison_parser_must_not_run'; END$$;")
  for (const spec of [
    {label:'ordinary PRODAT',family:'PRODAT',code:'Z02'},
    {label:'ordinary UTILTS',family:'UTILTS',code:'E31'},
    {label:'non-EDIFACT ACK',standard:'xml'},
    {label:'NULL metadata family',family:null,physical:'APERAK',code:'APERAK'},
    {label:'NULL metadata standard',standard:null},
    {label:'orphan NULL source pointer',related:null},
    {label:'UTILTS_ERR',family:'UTILTS_ERR',physical:'UTILTS',code:'ERR'}
  ]) {
    await seedBase()
    const m=await seedMessage({...spec,mismatch:true})
    await rejectsWithoutEffects(m,/ediel_source_projection_owned_outbound_request_required/)
    passed('CASE never evaluates declared poison parser port for '+spec.label)
  }
  await db.exec(actualWireAuthority.replace('CREATE FUNCTION ','CREATE OR REPLACE FUNCTION '))
  await seedBase()
  const nullableBusiness=await seedMessage({family:'PRODAT',code:'Z02'})
  await db.exec('UPDATE public.ediel_messages SET customer_id=NULL,site_id=NULL,metering_point_id=NULL WHERE direction=\'outbound\'; UPDATE public.outbound_requests SET customer_id=NULL,site_id=NULL,metering_point_id=NULL; UPDATE public.grid_owner_data_requests SET customer_id=NULL,site_id=NULL,metering_point_id=NULL;')
  await project(nullableBusiness)
  assert.equal(Date.parse((await ancestors()).outbound[0].sent_at),Date.parse(clock1))
  assert.equal(Date.parse((await ancestors()).data[0].sent_at),Date.parse(clock1))
  passed('ordinary matching NULL customer/site/point tuple still writes own request clock under original IS DISTINCT FROM semantics')
  await seedBase()
  const foreignSource=id(44444)
  await db.query('INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,status,message_sent_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [foreignSource,id(99),'test','inbound','edifact','PRODAT','Z04','completed',originalClock])
  const foreignBefore=(await db.query('SELECT to_jsonb(m) value FROM public.ediel_messages m WHERE id=$1',[foreignSource])).rows[0].value
  const foreignPointerAck=await seedMessage({related:foreignSource,mismatch:true})
  const foreignAncestors=await ancestors()
  await project(foreignPointerAck)
  assert.deepEqual((await db.query('SELECT to_jsonb(m) value FROM public.ediel_messages m WHERE id=$1',[foreignSource])).rows[0].value,foreignBefore)
  assert.deepEqual(await ancestors(),foreignAncestors)
  passed('seeded foreign related original COMPLETE row and all ancestral consumers unchanged by physical ACK effect omission')
  for(const mutate of [
    "UPDATE public.outbound_requests SET company_id='"+id(99)+"'",
    "UPDATE public.outbound_requests SET customer_id='"+id(99)+"'",
    "UPDATE public.outbound_requests SET site_id='"+id(99)+"'",
    "UPDATE public.outbound_requests SET metering_point_id='"+id(99)+"'",
    'DELETE FROM public.outbound_requests'
  ]) {
    await seedBase()
    const m=await seedMessage({family:'PRODAT',code:'Z02'})
    await db.exec(mutate)
    await rejectsWithoutEffects(m,/ediel_source_projection_owned_outbound_request_required/)
    passed('ordinary request tenant/tuple/existence adversity retains whole rollback: '+mutate.split(' SET ')[0])
  }
  for(const mutate of [
    "UPDATE public.user_profiles SET user_status='inactive'",
    'UPDATE public.company_memberships SET accepted_at=NULL',
    'UPDATE public.company_memberships SET is_active=false',
    'UPDATE public.fixture_permissions SET allowed=false'
  ]) {
    await seedBase()
    const m=await seedMessage({mismatch:true})
    await db.exec(mutate)
    await rejectsWithoutEffects(m,/ediel_source_projection_actor_forbidden/)
    await db.exec("UPDATE public.user_profiles SET user_status='active'; UPDATE public.company_memberships SET accepted_at='2026-10-08 08:00+00',is_active=true; UPDATE public.fixture_permissions SET allowed=true;")
    passed('ACK effect omission preserves current actor/membership/send authorization: '+mutate.split(' SET ')[0])
  }
  await seedBase()
  const scoped=await seedMessage({mismatch:true})
  await rejectsWithoutEffects(scoped,/actor_forbidden/,{scope:id(99)})
  await rejectsWithoutEffects(scoped,/actor_forbidden/,{executor:id(99)})
  await rejectsWithoutEffects(scoped,/query returned no rows/,{environment:'production'})
  await rejectsWithoutEffects(scoped,/ediel_source_projection_original_changed/,{expected:'f'.repeat(64)})
  passed('foreign tenant/actor/environment and wrong expected own hash retain original guards')
  const receiptAdversity=[
    {label:'unknown observation',sql:"UPDATE gridex_ediel_transport.attempts SET classification='unknown'",pattern:/accepted_receipt_required/},
    {label:'provider entry absent',sql:'UPDATE gridex_ediel_transport.attempts SET entered_at=NULL',pattern:/receipt_invalid/},
    {label:'provider recipient differs',sql:"UPDATE gridex_ediel_transport.attempts SET provider_result=jsonb_set(provider_result,'{accepted}','[\"other@example.invalid\"]')",pattern:/expected_recipient_required/},
    {label:'provider rejected a recipient',sql:"UPDATE gridex_ediel_transport.attempts SET provider_result=jsonb_set(provider_result,'{rejected}','[\"other@example.invalid\"]')",pattern:/expected_recipient_required/},
    {label:'frozen originalHash differs',sql:"UPDATE gridex_ediel_transport.attempts SET binding=jsonb_set(binding,'{originalHash}',to_jsonb(repeat('f',64)))",pattern:/original_changed/},
    {label:'observation clock absent',sql:'UPDATE gridex_ediel_transport.attempts SET observed_at=NULL',pattern:/receipt_invalid/},
    {label:'duplicate accepted observations',sql:"INSERT INTO gridex_ediel_transport.attempts SELECT '"+id(2999)+"',message_id,company_id,environment,binding,provider_result,classification,entered_at,observed_at FROM gridex_ediel_transport.attempts",pattern:/ambiguous/}
  ]
  for(const spec of receiptAdversity) {
    await seedBase()
    const m=await seedMessage({mismatch:true})
    await db.exec(spec.sql)
    await rejectsWithoutEffects(m,spec.pattern)
    passed(spec.label+' cannot gain projection from physical ACK classification')
  }
  for(const role of ['anon','authenticated']) {
    const allowed=(await db.query("SELECT has_function_privilege($1,'public.ediel_project_accepted_source_state_v1(uuid,text,uuid,uuid,text)','EXECUTE') allowed",[role])).rows[0].allowed
    assert.equal(allowed,false)
    passed(role+' cannot execute source projection')
  }
  assert.equal((await db.query("SELECT has_function_privilege('service_role','public.ediel_project_accepted_source_state_v1(uuid,text,uuid,uuid,text)','EXECUTE') allowed")).rows[0].allowed,true)
  passed('exact captured service_role projection privilege retained')
  result.status='PASS';result.checks=checks
  console.log(JSON.stringify(result))
} finally { await db.close() }
