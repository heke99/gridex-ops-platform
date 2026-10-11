// Finite index mechanics only. Minimal rows and locally installed btree_gist
// do not establish native catalog, ACK authority, source owners or concurrency.
// Genuine capture provenance and successful exact migration guard are separate
// delivery requirements; this runner never creates or rewrites captured assets.
import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {createHash} from 'node:crypto'
import assert from 'node:assert/strict'

const MIGRATION='20261009121545_ediel_source_bound_ack_origination_index.sql'
const MIGRATION_SHA="0a97eea312399d620a1541db781c407ad088997b099f8877a931c3e7e3df605d"
const DEFINITIONS={"preDefinition": "CREATE UNIQUE INDEX ux_ediel_outbound_source ON public.ediel_messages USING btree (company_id, direction, outbound_request_id, message_family, COALESCE(message_code, ''::text), receiver_ediel_id, COALESCE(message_version, ''::text)) WHERE ((direction = 'outbound'::text) AND (outbound_request_id IS NOT NULL))", "preSha256": "d11b3ae27566c19da1303493c2431858e76789d092a8242538f84dbfd16f2d30", "btreePostDefinition": "CREATE UNIQUE INDEX ux_ediel_outbound_source ON public.ediel_messages USING btree (company_id, direction, outbound_request_id, message_family, COALESCE(message_code, ''::text), receiver_ediel_id, COALESCE(message_version, ''::text)) WHERE ((direction = 'outbound'::text) AND (outbound_request_id IS NOT NULL) AND (NOT ((related_message_id IS NOT NULL) AND COALESCE((message_family = ANY (ARRAY['APERAK'::text, 'CONTRL'::text, 'UTILTS_ERR'::text])), false))))", "btreePostSha256": "06e4d7c441485da5a95014fdb7fa8994722ace870d6d87a56ec89b44226d6f46", "ackSha256": "dc3b57169e6649d5edd74cc88f6c3b4ea5cfb23f1014cbeed87af00d4b60a454", "constraintDefinition": "EXCLUDE USING gist (company_id WITH =, direction WITH =, outbound_request_id WITH =, message_family WITH =, COALESCE(message_code, ''::text) WITH =, receiver_ediel_id WITH =, COALESCE(message_version, ''::text) WITH =, (\nCASE\n    WHEN (related_message_id IS NULL) THEN numrange(NULL::numeric, NULL::numeric, '()'::text)\n    ELSE numrange((((((((('x'::text || substr(replace((id)::text, '-'::text, ''::text), 1, 8)))::bit(32))::bigint)::numeric * '79228162514264337593543950336'::numeric) + ((((('x'::text || substr(replace((id)::text, '-'::text, ''::text), 9, 8)))::bit(32))::bigint)::numeric * '18446744073709551616'::numeric)) + ((((('x'::text || substr(replace((id)::text, '-'::text, ''::text), 17, 8)))::bit(32))::bigint)::numeric * ('4294967296'::bigint)::numeric)) + ((((('x'::text || substr(replace((id)::text, '-'::text, ''::text), 25, 8)))::bit(32))::bigint)::numeric * (1)::numeric)), (((((((('x'::text || substr(replace((id)::text, '-'::text, ''::text), 1, 8)))::bit(32))::bigint)::numeric * '79228162514264337593543950336'::numeric) + ((((('x'::text || substr(replace((id)::text, '-'::text, ''::text), 9, 8)))::bit(32))::bigint)::numeric * '18446744073709551616'::numeric)) + ((((('x'::text || substr(replace((id)::text, '-'::text, ''::text), 17, 8)))::bit(32))::bigint)::numeric * ('4294967296'::bigint)::numeric)) + ((((('x'::text || substr(replace((id)::text, '-'::text, ''::text), 25, 8)))::bit(32))::bigint)::numeric * (1)::numeric)), '[]'::text)\nEND) WITH &&) WHERE (((direction = 'outbound'::text) AND (outbound_request_id IS NOT NULL) AND (message_family = ANY (ARRAY['APERAK'::text, 'CONTRL'::text, 'UTILTS_ERR'::text]))))", "constraintSha256": "0561f90e145c7e469c2a2b3f4b123dfd5b934160363b4677bb876792a98718cb", "gistIndexDefinition": "CREATE INDEX ediel_ack_business_legacy_scope_excl ON public.ediel_messages USING gist (company_id, direction, outbound_request_id, message_family, COALESCE(message_code, ''::text), receiver_ediel_id, COALESCE(message_version, ''::text), (\nCASE\n    WHEN (related_message_id IS NULL) THEN numrange(NULL::numeric, NULL::numeric, '()'::text)\n    ELSE numrange((((((((('x'::text || substr(replace((id)::text, '-'::text, ''::text), 1, 8)))::bit(32))::bigint)::numeric * '79228162514264337593543950336'::numeric) + ((((('x'::text || substr(replace((id)::text, '-'::text, ''::text), 9, 8)))::bit(32))::bigint)::numeric * '18446744073709551616'::numeric)) + ((((('x'::text || substr(replace((id)::text, '-'::text, ''::text), 17, 8)))::bit(32))::bigint)::numeric * ('4294967296'::bigint)::numeric)) + ((((('x'::text || substr(replace((id)::text, '-'::text, ''::text), 25, 8)))::bit(32))::bigint)::numeric * (1)::numeric)), (((((((('x'::text || substr(replace((id)::text, '-'::text, ''::text), 1, 8)))::bit(32))::bigint)::numeric * '79228162514264337593543950336'::numeric) + ((((('x'::text || substr(replace((id)::text, '-'::text, ''::text), 9, 8)))::bit(32))::bigint)::numeric * '18446744073709551616'::numeric)) + ((((('x'::text || substr(replace((id)::text, '-'::text, ''::text), 17, 8)))::bit(32))::bigint)::numeric * ('4294967296'::bigint)::numeric)) + ((((('x'::text || substr(replace((id)::text, '-'::text, ''::text), 25, 8)))::bit(32))::bigint)::numeric * (1)::numeric)), '[]'::text)\nEND)) WHERE ((direction = 'outbound'::text) AND (outbound_request_id IS NOT NULL) AND (message_family = ANY (ARRAY['APERAK'::text, 'CONTRL'::text, 'UTILTS_ERR'::text])))", "gistIndexSha256": "07319b4c19722fa5189375cc9a85fb1383ce066b37c531b1d231db66e2f9c401", "extension": {"extversion": "1.7", "namespace": "extensions"}}
const hash=value=>createHash('sha256').update(value).digest('hex')
const TARGET='ux_ediel_outbound_source',ACK='ux_ediel_ack_related'
const MIXED='ediel_ack_business_legacy_scope_excl'
let stage='source_authentication',sourceMode='unqualified',sourceQualification='unqualified',completedChecks=0

// Count declarations through SQL comments, while quoted values and function
// bodies cannot impersonate top level schema declarations. Keep quoted names.
const declarationText=source=>{
 const pieces=[]
 let position=0,start=0
 const discard=end=>{pieces.push(source.slice(start,position),source.slice(position,end).replace(/[^\n\r]/g,' '));position=end;start=end}
 while(position<source.length){
  if(source.startsWith('--',position)){
   const end=source.indexOf('\n',position+2)
   discard(end<0?source.length:end);continue
  }
  if(source.startsWith('/*',position)){
   let end=position+2,depth=1
   while(end<source.length&&depth){if(source.startsWith('/*',end)){depth++;end+=2}else if(source.startsWith('*/',end)){depth--;end+=2}else end++}
   assert.equal(depth,0);discard(end);continue
  }
  if(source[position]==="'"){
   const escaped=/[eE]/.test(source[position-1]??'')&&!/[A-Za-z0-9_$]/.test(source[position-2]??'')
   let end=position+1,closed=false
   while(end<source.length){if(escaped&&source[end]==='\\'){end+=2;continue}if(source[end]==="'"){if(source[end+1]==="'"){end+=2;continue}closed=true;end++;break}end++}
   assert.ok(closed);discard(end);continue
  }
  if(source[position]==='"'){
   let end=position+1,closed=false
   while(end<source.length){if(source[end]==='"'){if(source[end+1]==='"'){end+=2;continue}closed=true;end++;break}end++}
   assert.ok(closed)
   if(/^"[A-Za-z_][A-Za-z0-9_]*"$/.test(source.slice(position,end)))position=end
   else discard(end)
   continue
  }
  if(source[position]==='$'&&!/[A-Za-z0-9_$]/.test(source[position-1]??'')){
   const tag=source.slice(position).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)?.[0]
   if(tag){const end=source.indexOf(tag,position+tag.length);assert.ok(end>=0);discard(end+tag.length);continue}
  }
  position++
 }
 pieces.push(source.slice(start))
 return pieces.join('')
}

async function main(){
 const repository=resolve(process.env.EDIEL_SQL_REPOSITORY??fileURLToPath(new URL('../',import.meta.url)))
 stage='finite_dependency'
 if(!process.env.EDIEL_PGLITE_MODULE)throw Error('finite_dependency_required')
 stage='source_authentication'
 const schema=readFileSync(resolve(repository,'supabase/schema.sql'),'utf8')
 const sql=readFileSync(resolve(repository,'supabase/migrations',MIGRATION),'utf8')
 assert.equal(hash(sql),MIGRATION_SHA)
 const declarationsSource=declarationText(schema)
 const declarations=(name,kind)=>{
  const tail=kind==='index'?'CREATE\\s+(?:UNIQUE\\s+)?INDEX(?:\\s+CONCURRENTLY)?\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?':'ADD\\s+CONSTRAINT\\s+'
  return [...declarationsSource.matchAll(new RegExp(`${tail}(?:(?:public|"public")\\s*\\.\\s*)?"?${name}"?(?:\\s|;|$)`,'gmi'))]
 }
 const capturedIndex=name=>{
  const visible=declarations(name,'index')
  assert.equal(visible.length,1)
  const position=visible[0].index,prefix=`CREATE UNIQUE INDEX ${name} ON public.ediel_messages `
  assert.ok(position===0||schema[position-1]==='\n')
  assert.ok(schema.startsWith(prefix,position))
  const end=schema.indexOf('\n',position)
  const line=schema.slice(position,end<0?schema.length:end)
  assert.ok(line.endsWith(';')&&!line.slice(0,-1).includes(';'))
  return line.slice(0,-1)
 }
 const target=capturedIndex(TARGET),ack=capturedIndex(ACK),targetHash=hash(target)
 assert.equal(hash(ack),DEFINITIONS.ackSha256)
 assert.ok([DEFINITIONS.preSha256,DEFINITIONS.btreePostSha256].includes(targetHash))
 const pre=DEFINITIONS.preDefinition,post=DEFINITIONS.btreePostDefinition
 assert.equal(hash(pre),DEFINITIONS.preSha256)
 assert.equal(hash(post),DEFINITIONS.btreePostSha256)
 assert.equal(hash(DEFINITIONS.constraintDefinition),DEFINITIONS.constraintSha256)
 assert.equal(hash(DEFINITIONS.gistIndexDefinition),DEFINITIONS.gistIndexSha256)
 const oldSuffix=pre.slice(pre.indexOf(' WHERE ')),newSuffix=post.slice(post.indexOf(' WHERE '))
 assert.equal(pre.replace(oldSuffix,newSuffix),post)
 assert.equal(post.replace(newSuffix,oldSuffix),pre)
 sourceMode=targetHash===DEFINITIONS.preSha256?'captured_preimage':'already_captured_postimage'
 const constraintDeclarations=declarations(MIXED,'constraint')
 assert.equal(declarations(MIXED,'index').length,0)
 let capturedConstraint
 if(sourceMode==='captured_preimage')assert.equal(constraintDeclarations.length,0)
 else{
  assert.equal(constraintDeclarations.length,1)
  const position=constraintDeclarations[0].index,tablePrefix='ALTER TABLE ONLY public.ediel_messages\n    '
  const prefix=`ADD CONSTRAINT ${MIXED} `,start=position-tablePrefix.length
  assert.ok(start>=0&&(start===0||schema[start-1]==='\n'))
  assert.equal(schema.slice(start,position),tablePrefix)
  assert.equal(declarationsSource.slice(start,position),tablePrefix)
  assert.ok(schema.startsWith(prefix,position))
  const end=schema.indexOf(';',position)
  assert.ok(end>=0)
  const lineEnd=schema.indexOf('\n',end)
  assert.equal(schema.slice(end+1,lineEnd<0?schema.length:lineEnd).trim(),'')
  capturedConstraint=schema.slice(position+prefix.length,end)
  assert.equal(hash(capturedConstraint),DEFINITIONS.constraintSha256)
 }
 stage='finite_dependency'
 const modulePath=resolve(process.env.EDIEL_PGLITE_MODULE)
 const {PGlite}=await import(pathToFileURL(modulePath).href)
 const {btree_gist}=await import(pathToFileURL(resolve(modulePath,'../contrib/btree_gist.js')).href)
 const db=new PGlite({extensions:{btree_gist}}),checks=[],orphanCollisionSqlStates=new Set()
 const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
 let sequence=10
 const check=async(name,fn)=>{await fn();checks.push(name);completedChecks++}
 const rows=()=>db.query('SELECT * FROM public.ediel_messages ORDER BY id').then(r=>r.rows)
 const insert=async(v={})=>{
  const n=sequence++,row={id:id(n),company_id:id(1),environment:'test',direction:'outbound',outbound_request_id:id(2),message_family:'APERAK',message_code:'APERAK',receiver_ediel_id:'SYNTHETIC-RECEIVER',message_version:'D96A',related_message_id:id(n+1000),transaction_reference:'SYNTHETIC-REF',raw_payload:null,...v}
  const keys=Object.keys(row)
  await db.query(`INSERT INTO public.ediel_messages(${keys.join(',')}) VALUES(${keys.map((_,i)=>'$'+(i+1)).join(',')})`,keys.map(k=>row[k]))
  return row
 }
 const refused=async(name,fn,code,constraint)=>check(name,async()=>{
  const before=await rows()
  await assert.rejects(fn,error=>error.code===code&&error.constraint===constraint)
  assert.deepEqual(await rows(),before)
 })
 const orphanRefused=async(name,fn)=>check(name,async()=>{
  const before=await rows()
  await assert.rejects(fn,error=>{
   const recognized=(error.code==='23505'&&error.constraint===TARGET)||(error.code==='23P01'&&error.constraint===MIXED)
   if(recognized)orphanCollisionSqlStates.add(error.code)
   return recognized
  })
  assert.deepEqual(await rows(),before)
 })
 const idx=()=>db.query("SELECT c.oid,pg_get_indexdef(c.oid) definition,to_jsonb(i)-'indpred'-'indexrelid' metadata,c.relowner owner,c.reltablespace tablespace,c.reloptions options,c.relacl acl,obj_description(c.oid,'pg_class') comment FROM pg_class c JOIN pg_index i ON i.indexrelid=c.oid WHERE c.oid='public.ux_ediel_outbound_source'::regclass").then(r=>r.rows[0])
 const ackIndex=()=>db.query("SELECT to_jsonb(c) c,to_jsonb(i) i,pg_get_indexdef(c.oid) definition FROM pg_class c JOIN pg_index i ON i.indexrelid=c.oid WHERE c.oid='public.ux_ediel_ack_related'::regclass").then(r=>r.rows[0])
 const mixed=()=>db.query("SELECT con.oid,pg_get_constraintdef(con.oid) definition,pg_get_indexdef(con.conindid) index_definition,to_jsonb(con) constraint_metadata,to_jsonb(i) index_metadata,c.relowner owner,c.reltablespace tablespace,c.reloptions options,c.relacl acl FROM pg_constraint con JOIN pg_class c ON c.oid=con.conindid JOIN pg_index i ON i.indexrelid=con.conindid WHERE con.conrelid='public.ediel_messages'::regclass AND con.conname='ediel_ack_business_legacy_scope_excl'").then(r=>r.rows[0])
 const operators=()=>db.query("SELECT k.ord,ns.nspname namespace,opc.opcname name,am.amname method,opc.opcintype::regtype::text input_type,e.extname extension,ons.nspname operator_namespace,o.oprname operator_name FROM pg_index i JOIN pg_constraint con ON con.conindid=i.indexrelid CROSS JOIN LATERAL unnest(i.indclass::oid[]) WITH ORDINALITY k(oid,ord) JOIN pg_opclass opc ON opc.oid=k.oid JOIN pg_namespace ns ON ns.oid=opc.opcnamespace JOIN pg_am am ON am.oid=opc.opcmethod JOIN pg_amop strategy ON strategy.amopfamily=opc.opcfamily AND strategy.amopstrategy=3 AND strategy.amoplefttype=opc.opcintype AND strategy.amoprighttype=opc.opcintype AND strategy.amopmethod=opc.opcmethod AND strategy.amopopr=con.conexclop[k.ord] JOIN pg_operator o ON o.oid=strategy.amopopr JOIN pg_namespace ons ON ons.oid=o.oprnamespace LEFT JOIN pg_depend d ON d.classid='pg_opclass'::regclass AND d.objid=opc.oid AND d.deptype='e' LEFT JOIN pg_extension e ON e.oid=d.refobjid WHERE i.indexrelid='public.ediel_ack_business_legacy_scope_excl'::regclass ORDER BY k.ord").then(r=>r.rows)
 const qualifyMixed=async()=>{
  const m=await mixed()
  assert.ok(m)
  assert.equal(hash(m.definition),DEFINITIONS.constraintSha256)
  assert.equal(hash(m.index_definition),DEFINITIONS.gistIndexSha256)
  assert.deepEqual((await operators()).map(({namespace,name,method,input_type,extension,operator_namespace,operator_name})=>({namespace,name,method,input_type,extension,operator_namespace,operator_name})),[
   ...['uuid','text','uuid','text','text','text','text'].map(input_type=>({namespace:'extensions',name:`gist_${input_type}_ops`,method:'gist',input_type,extension:'btree_gist',operator_namespace:'pg_catalog',operator_name:'='})),
   {namespace:'pg_catalog',name:'range_ops',method:'gist',input_type:'anyrange',extension:null,operator_namespace:'pg_catalog',operator_name:'&&'}
  ])
  const collations=(await db.query("SELECT g.ord,g.oid gist,b.oid btree,c.collisdeterministic deterministic FROM pg_index gi JOIN pg_index bi ON bi.indexrelid='public.ux_ediel_outbound_source'::regclass CROSS JOIN LATERAL unnest(gi.indcollation::oid[]) WITH ORDINALITY g(oid,ord) JOIN LATERAL unnest(bi.indcollation::oid[]) WITH ORDINALITY b(oid,ord) ON b.ord=g.ord LEFT JOIN pg_collation c ON c.oid=g.oid WHERE gi.indexrelid='public.ediel_ack_business_legacy_scope_excl'::regclass ORDER BY g.ord")).rows
  assert.equal(collations.length,7)
  for(const row of collations){assert.equal(row.gist,row.btree);if(row.gist!==0)assert.equal(row.deterministic,true)}
  assert.equal(m.constraint_metadata.contype,'x')
  assert.equal(m.constraint_metadata.condeferrable,false)
  assert.equal(m.constraint_metadata.condeferred,false)
  assert.equal(m.constraint_metadata.convalidated,true)
  assert.equal(m.index_metadata.indisvalid,true)
  assert.equal(m.index_metadata.indisready,true)
  assert.equal(m.index_metadata.indislive,true)
  assert.equal(m.index_metadata.indisexclusion,true)
 }
 const fresh=async(targetDefinition=pre,constraintDefinition,constraintFirst=false)=>{
  await db.exec('DROP TABLE IF EXISTS public.ediel_messages CASCADE')
  await db.exec('CREATE TABLE public.ediel_messages(id uuid PRIMARY KEY,company_id uuid,environment text,direction text,outbound_request_id uuid,message_family text,message_code text,receiver_ediel_id text,message_version text,related_message_id uuid,transaction_reference text,raw_payload text)')
  if(constraintDefinition&&constraintFirst)await db.exec(`ALTER TABLE public.ediel_messages ADD CONSTRAINT ${MIXED} ${constraintDefinition};`)
  await db.exec(targetDefinition+';'+ack+';')
  if(constraintDefinition&&!constraintFirst)await db.exec(`ALTER TABLE public.ediel_messages ADD CONSTRAINT ${MIXED} ${constraintDefinition};`)
 }
 const forward=async()=>{await db.exec(sql);assert.equal(hash((await idx()).definition),DEFINITIONS.btreePostSha256);await qualifyMixed()}
 const migrationRefused=async(name,setup,pattern)=>check(name,async()=>{
  await fresh();await setup()
  const before=await idx(),a=await ackIndex(),m=await mixed(),beforeRows=await rows()
  await assert.rejects(()=>db.exec(sql),pattern)
  await db.exec('ROLLBACK')
  assert.deepEqual(await idx(),before);assert.deepEqual(await ackIndex(),a);assert.deepEqual(await mixed(),m);assert.deepEqual(await rows(),beforeRows)
 })
 try{
  stage='finite_dependency_catalog'
  await db.exec('CREATE SCHEMA extensions;CREATE EXTENSION btree_gist WITH SCHEMA extensions;SET search_path=pg_catalog,public,extensions')
  await check('named synthetic finite dependency catalog',async()=>{
   assert.deepEqual((await db.query("SELECT extversion,n.nspname namespace FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE extname='btree_gist'")).rows,[{extversion:DEFINITIONS.extension.extversion,namespace:DEFINITIONS.extension.namespace}])
  })
  stage='source_index_qualification'
  // Execute the genuine captured target and, in post mode, genuine captured
  // constraint BEFORE donor redispatch or historical negative reconstruction.
  await fresh(target,capturedConstraint)
  await check('actual captured target and ACK deparse',async()=>{
   assert.equal((await idx()).definition,target)
   assert.equal(hash((await ackIndex()).definition),DEFINITIONS.ackSha256)
  })
  await check('qualified captured paired source mode',async()=>{
   if(sourceMode==='captured_preimage'){await forward();sourceQualification='applied_forward'}
   else{await qualifyMixed();assert.equal(hash((await idx()).definition),DEFINITIONS.btreePostSha256);sourceQualification='already_captured_postimage'}
  })
  stage='historical_negative_controls'
  await fresh()
  await check('historical seven-key predecessor deparse and full inverse',async()=>{assert.equal((await idx()).definition,pre);assert.equal(hash((await ackIndex()).definition),DEFINITIONS.ackSha256);assert.equal(await mixed(),undefined)})
  const first=await insert({raw_payload:'DECLARED-SYNTHETIC-NON-AUTHORITY-BYTES'})
  await refused('RED distinct source bound APERAK identical business key',()=>insert(),'23505',TARGET)
  await db.exec("CREATE ROLE synthetic_index_owner;ALTER INDEX public.ux_ediel_outbound_source OWNER TO synthetic_index_owner;COMMENT ON INDEX public.ux_ediel_outbound_source IS 'Declared synthetic preserved comment'")
  const before=await idx(),beforeAck=await ackIndex(),beforeRows=await rows()
  await check('forward preserves seven key metadata owner comment rows ACK OID and body',async()=>{
   await forward();const after=await idx()
   assert.notEqual(after.oid,before.oid)
   assert.deepEqual({...after,oid:before.oid,definition:before.definition},before)
   assert.deepEqual(await ackIndex(),beforeAck);assert.deepEqual(await rows(),beforeRows)
  })
  await check('GREEN distinct source bound APERAK same business key',()=>insert())
  await refused('same source and same transaction remains unique',()=>insert({related_message_id:first.related_message_id}),'23505',ACK)
  await check('same original legitimate separate transaction remains allowed',()=>insert({related_message_id:first.related_message_id,transaction_reference:'SYNTHETIC-SEPARATE-TX'}))
  for(const family of ['CONTRL','UTILTS_ERR']){
   const own=await insert({message_family:family,message_code:family})
   await check(`distinct source bound ${family} allowed`,()=>insert({message_family:family,message_code:family}))
   await refused(`same source ${family} unchanged owner`,()=>insert({message_family:family,message_code:family,related_message_id:own.related_message_id}),'23505',ACK)
   await check(`same original separate ${family} transaction allowed`,()=>insert({message_family:family,message_code:family,related_message_id:own.related_message_id,transaction_reference:'SYNTHETIC-SEPARATE-TX'}))
  }
  for(const family of ['PRODAT','UTILTS','UNRELATED']){
   await insert({message_family:family,message_code:'ORIGINAL'})
   await refused(`non ACK ${family} original uniqueness`,()=>insert({message_family:family,message_code:'ORIGINAL'}),'23505',TARGET)
  }
  await check('nonnull raw removal preserves all nonraw rows and constraints',async()=>{
   const preRow=(await rows()).find(r=>r.id===first.id),i=await idx(),a=await ackIndex(),m=await mixed()
   await db.query('UPDATE public.ediel_messages SET raw_payload=NULL WHERE id=$1',[first.id])
   const postRow=(await rows()).find(r=>r.id===first.id)
   assert.equal(preRow.raw_payload,'DECLARED-SYNTHETIC-NON-AUTHORITY-BYTES');assert.equal(postRow.raw_payload,null)
   assert.deepEqual({...postRow,raw_payload:preRow.raw_payload},preRow)
   assert.deepEqual(await idx(),i);assert.deepEqual(await ackIndex(),a);assert.deepEqual(await mixed(),m)
  })
  await check('postimage redispatch idempotent all constraints OIDs rows metadata',async()=>{
   const i=await idx(),a=await ackIndex(),m=await mixed(),r=await rows()
   await db.exec(sql)
   assert.deepEqual(await idx(),i);assert.deepEqual(await ackIndex(),a);assert.deepEqual(await mixed(),m);assert.deepEqual(await rows(),r)
  })
  stage='mixed_ack_mechanics'
  for(const family of ['APERAK','CONTRL','UTILTS_ERR']){
   await fresh()
   await insert({message_family:family,message_code:family,related_message_id:null})
   await refused(`RED ${family} old orphan then bound collision`,()=>insert({message_family:family,message_code:family}),'23505',TARGET)
   await fresh()
   await insert({message_family:family,message_code:family})
   await refused(`RED ${family} old bound then orphan collision`,()=>insert({message_family:family,message_code:family,related_message_id:null}),'23505',TARGET)
   const originalOther=await insert({message_family:family,message_code:'OTHER-KEY'})
   await refused(`RED ${family} old update key into orphan collision`,()=>db.query('UPDATE public.ediel_messages SET related_message_id=NULL,message_code=$2 WHERE id=$1',[originalOther.id,family]),'23505',TARGET)
   // Each order has its own old-key scope; failures verify full row rollback.
   await fresh();await forward()
   await insert({message_family:family,message_code:family,related_message_id:null})
   await orphanRefused(`${family} orphan orphan legacy integrity btree first`,()=>insert({message_family:family,message_code:family,related_message_id:null}))
   await refused(`${family} orphan then bound mixed exclusion`,()=>insert({message_family:family,message_code:family}),'23P01',MIXED)
   await fresh();await forward()
   await insert({message_family:family,message_code:family})
   await refused(`${family} bound then orphan mixed exclusion`,()=>insert({message_family:family,message_code:family,related_message_id:null}),'23P01',MIXED)
   const other=await insert({message_family:family,message_code:family})
   await refused(`${family} bound update to orphan preserves old business collision`,()=>db.query('UPDATE public.ediel_messages SET related_message_id=NULL WHERE id=$1',[other.id]),'23P01',MIXED)
   await check(`${family} orphan outside collision may bind`,async()=>{
    const orphan=await insert({message_family:family,message_code:'OTHER-KEY',related_message_id:null})
    await db.query('UPDATE public.ediel_messages SET related_message_id=$2 WHERE id=$1',[orphan.id,id(sequence+10000)])
    assert.ok((await rows()).find(r=>r.id===orphan.id).related_message_id)
   })
   for(const field of ['company_id','message_family','receiver_ediel_id']){
    await fresh();await forward()
    const values={message_family:family,message_code:family,[field]:null}
    await check(`${family} old nullable ${field} retains NULL DISTINCT mixed allowance`,async()=>{await insert({...values,related_message_id:null});await insert(values);assert.equal((await rows()).length,2)})
   }
   for(const [field,value] of [['direction',null],['direction','inbound'],['outbound_request_id',null]]){
    await fresh();await forward()
    await check(`${family} excluded ${field} ${value===null?'null':'inbound'} mixed allowance`,async()=>{await insert({message_family:family,message_code:family,[field]:value,related_message_id:null});await insert({message_family:family,message_code:family,[field]:value});assert.equal((await rows()).length,2)})
   }
   for(const field of ['message_code','message_version']){
    await fresh();await forward()
    await insert({message_family:family,message_code:family,[field]:null,related_message_id:null})
    await refused(`${family} coalesced ${field} null and empty mixed collision`,()=>insert({message_family:family,message_code:family,[field]:''}),'23P01',MIXED)
   }
   // Explicit historical DDL-order control, not a prospective capture.
   // Both constraints cover orphan pairs, so native index order can change
   // the rejected class without changing preserved integrity.
   await fresh(post,DEFINITIONS.constraintDefinition,true);await qualifyMixed()
   await insert({message_family:family,message_code:family,related_message_id:null})
   await orphanRefused(`${family} orphan orphan legacy integrity GiST first`,()=>insert({message_family:family,message_code:family,related_message_id:null}))
  }
  await fresh();await forward()
  await check('all seven business key dimensions preserve independent scope',async()=>{
   const seed=await insert({related_message_id:null})
   for(const v of [{company_id:id(4)},{direction:'inbound'},{outbound_request_id:id(5)},{message_family:'CONTRL'},{message_code:'OTHER'},{receiver_ediel_id:'OTHER'},{message_version:'OTHER'}])await insert({...v,related_message_id:null})
   assert.equal((await rows()).length,8)
   assert.ok((await rows()).find(r=>r.id===seed.id))
  })
  await check('bound primary UUID extremes map injectively without source UUID grouping',async()=>{
   const seeds=['00000000-0000-0000-0000-000000000000','ffffffff-ffff-ffff-ffff-ffffffffffff','80000000-0000-0000-0000-000000000000']
   for(const [n,v] of seeds.entries())await insert({id:v,related_message_id:id(9000),transaction_reference:`SYNTHETIC-EXTREME-${n}`,message_code:'EXTREME'})
   assert.equal((await rows()).filter(r=>r.message_code==='EXTREME').length,3)
  })
  stage='migration_refusals'
  await migrationRefused('unknown whole predecessor no effects',()=>db.exec("DROP INDEX public.ux_ediel_outbound_source;CREATE UNIQUE INDEX ux_ediel_outbound_source ON public.ediel_messages(company_id,outbound_request_id) WHERE direction='outbound'"),/unknown_predecessor/)
  await migrationRefused('foreign ACK index changed no effects',()=>db.exec("DROP INDEX public.ux_ediel_ack_related;CREATE UNIQUE INDEX ux_ediel_ack_related ON public.ediel_messages(company_id,related_message_id,message_family) WHERE related_message_id IS NOT NULL"),/replay_index_changed/)
  await migrationRefused('storage option predecessor no effects',()=>db.exec('ALTER INDEX public.ux_ediel_outbound_source SET(fillfactor=70)'),/unknown_predecessor|metadata_predecessor_required/)
  await migrationRefused('post btree without mixed constraint refused',()=>db.exec('DROP INDEX public.ux_ediel_outbound_source;'+post+';'),/unknown_predecessor|mixed|constraint|postimage/)
  await migrationRefused('foreign mixed constraint on old btree refused',()=>db.exec(`ALTER TABLE public.ediel_messages ADD CONSTRAINT ${MIXED} CHECK (true)`),/unknown_predecessor|mixed|constraint|postimage/)
  await check('partial old btree independently cannot cluster',async()=>{await assert.rejects(()=>db.exec('ALTER TABLE public.ediel_messages CLUSTER ON ux_ediel_outbound_source'),error=>error.code==='0A000')})
  console.log(JSON.stringify({status:'PASS',sourceMode,sourceQualification,checks:checks.length,sourceQualificationChecks:2,
   sourceSchemaSha256:hash(schema),migrationSha256:MIGRATION_SHA,btreePostSha256:DEFINITIONS.btreePostSha256,
   mixedConstraintSha256:DEFINITIONS.constraintSha256,gistIndexSha256:DEFINITIONS.gistIndexSha256,
   finiteDependencyCatalog:'named_synthetic_btree_gist',nativeDependencyEvidence:'producer_guard_required',mixedCollisionSqlState:'23P01',
   orphanCollisionSqlStates:[...orphanCollisionSqlStates].sort(),nativeConcurrency:'NOT_RUN'}))
 }finally{await db.close()}
}
main().catch(error=>{
 let code
 try{code=Object.getOwnPropertyDescriptor(error,'code')?.value}catch{/* fixed unknown class */}
 const sqlState=['23505','23P01','P0001','0A000','42501','42P01','42703','42883'].find(value=>value===code)??'unknown'
 console.error(JSON.stringify({status:'FAIL',stage,sourceMode,sourceQualification,checks:completedChecks,sqlState}))
 process.exitCode=1
})
