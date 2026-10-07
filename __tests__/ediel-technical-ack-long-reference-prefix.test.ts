// masterplan: SC-014, AT-Z14V-ESCO
// Execute the full captured require_contrl guard, lexer and envelope in PostgreSQL.
// Public rows, captured-source basis and current-endpoint readers are declared
// finite IO ports. No private accepted authority, native admission or SMTP is
// seeded or claimed. Full-trigger/native qualification remains a separate gate.
import {createHash} from 'node:crypto'
import {existsSync,readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {PGlite} from '@electric-sql/pglite'
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it} from 'vitest'

const schema=readFileSync(resolve('supabase/schema.sql'),'utf8')
const migration=resolve('supabase/migrations/20261007000503_ediel_technical_ack_long_reference_prefix.sql')
const signature='gridex_ediel_technical_ack.require_contrl_v1(public.ediel_messages)'
const id=(n:number)=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`
const company=id(1),foreign=id(2),sourceId=id(10),ackId=id(11),prefix='ABCDEFGHIJKLMN'
type Envelope={sender:string[];receiver:string[];interchangeReference:string;uciReference:string;applicationReference:string;environment:string;testIndicator:string}
const forward=readFileSync(migration,'utf8')
const epochHashes={old:'3232a29750f83738243ac958a500d572c21cdc0543c25a5bdcf46ea03869c2a3',new:'464abc12a297a8c6e6cd682499e1750f36f993b50abd1a97e311de5fb027551f'} as const
type Epoch=keyof typeof epochHashes
const digest=(text:string)=>createHash('sha256').update(text).digest('hex')
function definition(name:string){
 const start=schema.indexOf('CREATE FUNCTION '+name+'(')
 if(start<0)throw Error('actual_function_missing:'+name)
 const rest=schema.slice(start),delimiter=rest.match(/AS (\$[^$]*\$)/)?.[1]
 if(!delimiter)throw Error('actual_function_body_missing:'+name)
 const end=rest.indexOf(delimiter+';',rest.indexOf(delimiter)+delimiter.length)
 if(end<0)throw Error('actual_function_end_missing:'+name)
 return rest.slice(0,end+delimiter.length+1)
}
function functionBody(definition:string){
 const delimiter=definition.match(/AS (\$[^$]*\$)/)?.[1]
 if(!delimiter)throw Error('closed_capture_body_unavailable')
 const start=definition.indexOf(delimiter)+delimiter.length,end=definition.indexOf(delimiter,start)
 if(end<start)throw Error('closed_capture_body_unavailable')
 return definition.slice(start,end)
}
function closedEpochDefinition(definition:string,epoch:Epoch){
 const body=functionBody(definition),hash=digest(body)
 if(hash!==epochHashes.old&&hash!==epochHashes.new)throw Error('closed_capture_epoch_unrecognized')
 if(hash===epochHashes[epoch])return definition
 // This single frozen inverse/forward is only a disposable capture/lifecycle
 // fixture. The lexer, envelope and every other captured guard byte stay real.
 const old=forward.match(/needle CONSTANT text:=\$needle\$([\s\S]*?)\$needle\$/)?.[1]
 const current=forward.match(/replacement CONSTANT text:=\$replacement\$([\s\S]*?)\$replacement\$/)?.[1]
 if(!old||!current)throw Error('closed_capture_transform_unavailable')
 const needle=epoch==='old'?current:old,replacement=epoch==='old'?old:current
 if(body.split(needle).length!==2)throw Error('closed_capture_transform_unrecognized')
 const transformed=body.replace(needle,()=>replacement)
 if(digest(transformed)!==epochHashes[epoch])throw Error('closed_capture_transform_unrecognized')
 return definition.replace(body,()=>transformed)
}
function wire(reference:string,options:{advice?:string;separator?:string;terminator?:string;sender?:string;receiver?:string;application?:string;test?:boolean}={}){
 const {advice='',separator:s='+',terminator:t="'",sender='12345:14',receiver='54321:14',application='23-DGI-PRODAT',test=false}=options
 return advice+`UNB${s}UNOC:3${s}${sender}${s}${receiver}${s}261001:1200${s}${reference}${s}${s}${application}${s}${s}1${s}${s}${test?'1':''}${t}UNH${s}1${s}PRODAT:D:97A:UN:E2SE6A${t}UNT${s}2${s}1${t}UNZ${s}1${s}${reference}${t}`
}
const long=()=>wire(prefix+'123456')
const released=()=>long().replaceAll('+'+prefix,'+?'+prefix)
const split=(framing:string)=>long().replaceAll(prefix,prefix.slice(0,6)+framing+prefix.slice(6))
const customRelease=()=>wire(prefix+'123456',{advice:"UNA:+.! '"}).replaceAll('+'+prefix,'+!'+prefix)
const alternate=()=>wire(prefix+'123456',{advice:'UNA:*.? ~',separator:'*',terminator:'~'})

// Both epochs are closed disposable fixture copies of the actual captured
// definition. This is not a claim that GEN has published either capture.
describe.each(['old','new'] as const)('closed captured epoch %s',epoch=>{
let db:PGlite
let originalCatalog:unknown
beforeAll(async()=>{
 db=new PGlite()
 await db.exec(`CREATE SCHEMA gridex_utilts_binding;CREATE SCHEMA gridex_ediel_technical_ack;
 CREATE TABLE public.ediel_messages(id uuid PRIMARY KEY,company_id uuid,environment text,direction text,message_family text,related_message_id uuid,raw_payload text);
 CREATE TABLE public.probe_captured_basis(company_id uuid,source_id uuid,payload_hash text,evidence jsonb);
 CREATE TABLE public.probe_current_endpoint(qualified boolean);
 INSERT INTO probe_current_endpoint VALUES(true);
 CREATE FUNCTION gridex_ediel_technical_ack.require_source_v1(c uuid,s uuid) RETURNS jsonb LANGUAGE plpgsql AS $$DECLARE result jsonb;BEGIN
 SELECT b.evidence INTO result FROM public.probe_captured_basis b JOIN public.ediel_messages m ON m.id=b.source_id AND m.direction='inbound'
 WHERE b.company_id=c AND b.source_id=s AND b.payload_hash=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex');
 IF result IS NULL THEN RAISE EXCEPTION 'finite_captured_basis_unavailable';END IF;RETURN result;END$$;
 CREATE FUNCTION gridex_ediel_technical_ack.require_current_endpoint_v1(jsonb) RETURNS void LANGUAGE plpgsql AS $$BEGIN
 IF (SELECT qualified FROM public.probe_current_endpoint) IS DISTINCT FROM true THEN RAISE EXCEPTION 'finite_current_endpoint_unqualified';END IF;END$$;
 CREATE FUNCTION gridex_ediel_technical_ack.retained_source_v1(public.ediel_messages,boolean) RETURNS uuid LANGUAGE plpgsql AS $$BEGIN
 RAISE EXCEPTION 'finite_retained_reader_not_selected';END$$;`)
 await db.exec(definition('gridex_utilts_binding.wire_tokens_v1'))
 await db.exec(definition('gridex_ediel_technical_ack.envelope'))
 await db.exec('BEGIN')
 await db.exec(closedEpochDefinition(definition('gridex_ediel_technical_ack.require_contrl_v1'),epoch))
 // A nondefault finite ACL makes lost privileges observable; no native grant
 // or protected accepted authority is supplied by this disposable catalog.
 await db.exec(`CREATE ROLE probe_guard_role;REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC;GRANT EXECUTE ON FUNCTION ${signature} TO probe_guard_role`)
 originalCatalog=(await db.query<{metadata:unknown}>(`SELECT to_jsonb(p)-'prosrc' metadata FROM pg_proc p WHERE oid=$1::regprocedure`,[signature])).rows[0].metadata
 expect((await db.query<{hash:string}>(`SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') hash FROM pg_proc WHERE oid=$1::regprocedure`,[signature])).rows[0].hash)
  .toBe(epochHashes[epoch])
 if(epoch==='new'){
  const definition=(await db.query<{definition:string}>('SELECT pg_get_functiondef(oid) definition FROM pg_proc WHERE oid=$1::regprocedure',[signature])).rows[0].definition
  // Exercise old-to-forward catalog preservation even after a genuine new
  // capture. The inverse exists only inside this disposable transaction.
  await db.exec(closedEpochDefinition(definition,'old'))
  expect((await db.query<{hash:string}>(`SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') hash FROM pg_proc WHERE oid=$1::regprocedure`,[signature])).rows[0].hash).toBe(epochHashes.old)
 }
 await db.exec(forward)
 const installed=(await db.query<{metadata:unknown;prosrc:string}>(`SELECT to_jsonb(p)-'prosrc' metadata,prosrc FROM pg_proc p WHERE oid=$1::regprocedure`,[signature])).rows[0]
 expect(installed.metadata).toEqual(originalCatalog)
 expect(installed.prosrc).toBe(functionBody(closedEpochDefinition(definition('gridex_ediel_technical_ack.require_contrl_v1'),'new')))
 expect(digest(installed.prosrc)).toBe(epochHashes.new)
 await db.exec('COMMIT')
},30_000)
beforeEach(async()=>{await db.exec('BEGIN')})
afterEach(async()=>{await db.exec('ROLLBACK')})
afterAll(async()=>{await db?.close()})
async function addSource(raw:string,n=10,tenant=company){
 await db.query('INSERT INTO ediel_messages(id,company_id,environment,direction,message_family,raw_payload) VALUES($1,$2,$3,$4,$5,$6)',[id(n),tenant,'production','inbound','PRODAT',raw])
}
async function admittedPort(raw:string){
 await addSource(raw)
 const envelope=(await db.query<{e:Envelope}>('SELECT gridex_ediel_technical_ack.envelope($1) e',[raw])).rows[0].e
 expect(envelope).not.toBeNull()
 const evidence={companyId:company,environment:envelope.environment,syntaxDecision:'accepted',originalUNB:envelope}
 await db.query(`INSERT INTO probe_captured_basis VALUES($1,$2,encode(sha256(convert_to($3,'UTF8')),'hex'),$4)`,[company,sourceId,raw,evidence])
 return {envelope,evidence}
}
function ack(envelope:Envelope,change:Record<string,unknown>={}){
 const payload=`UNB+UNOC:3+${envelope.receiver.join(':')}+${envelope.sender.join(':')}+261001:1200+ACK++${envelope.applicationReference}++++${envelope.testIndicator}'UNH+A+CONTRL:2:2:UN'UCI+${envelope.uciReference.replaceAll('?','??').replaceAll('+','?+')}+${envelope.sender.join(':')}+${envelope.receiver.join(':')}+1'UNT+3+A'UNZ+1+ACK'`
 return {id:ackId,company_id:company,environment:envelope.environment,direction:'outbound',message_family:'CONTRL',related_message_id:sourceId,raw_payload:payload,...change}
}
async function guard(row:ReturnType<typeof ack>){
 return(await db.query<{e:unknown}>(`SELECT ${signature.split('(')[0]}(jsonb_populate_record(NULL::public.ediel_messages,$1)) e`,[row])).rows[0].e
}
async function snapshot(){return(await db.query<{b:unknown}>(`SELECT jsonb_build_object('messages',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM ediel_messages m),'basis',(SELECT jsonb_agg(to_jsonb(b) ORDER BY source_id) FROM probe_captured_basis b)) b`)).rows[0].b}
async function refuses(row:ReturnType<typeof ack>,reason:string){
 const before=await snapshot()
 await db.exec('SAVEPOINT refusing_guard')
 await expect(guard(row)).rejects.toThrow(reason)
 await db.exec('ROLLBACK TO SAVEPOINT refusing_guard')
 expect(await snapshot()).toEqual(before)
}

it.each([
 ['plain20',long],['default release',released],['LF framing',()=>split('\n')],['CRLF framing',()=>split('\r\n')],['custom release',customRelease],['custom separators',alternate],
])('the full current CONTRL guard qualifies the sole %s original using logical first14',async(_name,make)=>{
 const raw=make(),{envelope,evidence}=await admittedPort(raw),before=await snapshot()
 expect(envelope.interchangeReference).toBe(prefix+'123456');expect(envelope.uciReference).toBe(prefix)
 expect(await guard(ack(envelope))).toEqual(evidence)
 expect(await snapshot()).toEqual(before)
})
it.each([
 ['plain20',long],['default release',released],['LF framing',()=>split('\n')],['CRLF framing',()=>split('\r\n')],['custom release',customRelease],['custom separators',alternate],
])('foreign %s with the same logical first14 remains globally ambiguous before company restriction',async(_name,make)=>{
 const {envelope}=await admittedPort(wire(prefix))
 await addSource(make(),20,foreign)
 await refuses(ack(envelope),'ediel_technical_ack_original_ambiguous')
})
it('retains exactly14 and short references without admitting unrelated long noise',async()=>{
 for(const reference of[prefix,'I']){
  await db.exec('TRUNCATE ediel_messages,probe_captured_basis')
  const {envelope,evidence}=await admittedPort(wire(reference))
  for(let i=0;i<100;i++)await addSource(wire('I'+String(i).padStart(19,'0')),100+i,foreign)
  expect(await guard(ack(envelope))).toEqual(evidence)
 }
})
it('retains a nonalphanumeric released-reference full-parse fallback',async()=>{
 const {envelope,evidence}=await admittedPort(wire('AB?+CDEFGHIJKLMN123456'))
 expect(envelope.interchangeReference).toBe('AB+CDEFGHIJKLMN123456')
 expect(await guard(ack(envelope))).toEqual(evidence)
 await addSource(wire('AB?+CDEFGHIJKLMN654321'),20,foreign)
 await refuses(ack(envelope),'ediel_technical_ack_original_ambiguous')
})
it.each([
 ['sender',wire(prefix+'654321',{sender:'99999:14'})],['qualifier',wire(prefix+'654321',{sender:'12345:ZZ'})],
 ['subaddress',wire(prefix+'654321',{sender:'12345:14:OTHER'})],['receiver',wire(prefix+'654321',{receiver:'99999:14'})],
 ['application',wire(prefix+'654321',{application:'OTHER'})],['environment',wire(prefix+'654321',{test:true})],
 ['prefix elsewhere',wire('OTHER').replace('23-DGI-PRODAT',prefix)],['malformed envelope',"UNB+UNOC:3+12345:14+54321:14+261001:1200+"+prefix],
])('a conservative candidate with different %s does not gain exact original identity',async(_name,other)=>{
 const {envelope,evidence}=await admittedPort(wire(prefix));await addSource(other,20,foreign)
 expect(await guard(ack(envelope))).toEqual(evidence)
})
it.each(['UCI','reversed parties','environment','syntax outcome'] as const)('keeps full CONTRL %s correspondence checks',async(target)=>{
 const {envelope}=await admittedPort(wire(prefix)),row=ack(envelope)
 if(target==='UCI')row.raw_payload=row.raw_payload.replace('UCI+'+prefix,'UCI+OTHER')
 if(target==='reversed parties')row.raw_payload=row.raw_payload.replace('+54321:14+12345:14+','+OTHER:14+12345:14+')
 if(target==='environment')row.environment='test'
 if(target==='syntax outcome')row.raw_payload=row.raw_payload.replace('+1\'UNT','+4\'UNT')
 await refuses(row,'ediel_technical_ack_basis_required')
})
it('retains independent current-endpoint and captured-source refusal',async()=>{
 const {envelope}=await admittedPort(wire(prefix))
 await db.exec('UPDATE probe_current_endpoint SET qualified=false')
 await refuses(ack(envelope),'finite_current_endpoint_unqualified')
 await db.exec('UPDATE probe_current_endpoint SET qualified=true;DELETE FROM probe_captured_basis')
 await refuses(ack(envelope),'finite_captured_basis_unavailable')
})
it('keeps the short-reference cheap prefilter selective before parsing long noise',async()=>{
 const {evidence}=await admittedPort(wire('I'))
 await db.exec('DELETE FROM ediel_messages;DELETE FROM probe_captured_basis')
 for(let i=0;i<100;i++)await addSource(wire('I'+String(i).padStart(19,'0')),100+i,foreign)
 const body=(await db.query<{prosrc:string}>('SELECT prosrc FROM pg_proc WHERE oid=$1::regprocedure',[signature])).rows[0].prosrc
 const start=body.indexOf('SELECT o.* FROM public.ediel_messages o WHERE o.direction=\'inbound\''),end=body.indexOf(' OFFSET 0) old',start)
 expect(start).toBeGreaterThan(0);expect(end).toBeGreaterThan(start)
 const cheap=body.slice(start,end).replaceAll('evidence#','$1::jsonb#')
 expect((await db.query<{n:number}>('SELECT count(*)::int n FROM ('+cheap+') candidates',[evidence])).rows[0].n).toBe(0)
})
it('the forward preserves the actual function OID, owner, ACL, configuration and all other catalog fields',async()=>{
 expect(existsSync(migration)).toBe(true)
 expect((await db.query<{metadata:unknown}>(`SELECT to_jsonb(p)-'prosrc' metadata FROM pg_proc p WHERE oid=$1::regprocedure`,[signature])).rows[0].metadata).toEqual(originalCatalog)
})
it('reapplying the recognized forward preserves exact body and catalog metadata',async()=>{
 const catalog=async()=>(await db.query<{row:unknown}>('SELECT to_jsonb(p) row FROM pg_proc p WHERE oid=$1::regprocedure',[signature])).rows[0].row
 const before=await catalog();await db.exec(readFileSync(migration,'utf8'))
 expect(await catalog()).toEqual(before)
})
it('an independently changed predecessor is refused without altering its body or metadata',async()=>{
 const f=(await db.query<{body:string;definition:string}>('SELECT prosrc body,pg_get_functiondef(oid) definition FROM pg_proc WHERE oid=$1::regprocedure',[signature])).rows[0]
 await db.exec(f.definition.replace(f.body,()=>f.body+'\n-- independently changed predecessor\n'))
 const before=(await db.query<{row:unknown}>('SELECT to_jsonb(p) row FROM pg_proc p WHERE oid=$1::regprocedure',[signature])).rows[0].row
 await db.exec('SAVEPOINT unknown_predecessor')
 await expect(db.exec(readFileSync(migration,'utf8'))).rejects.toThrow('technical_ack_prefix_predecessor_required')
 await db.exec('ROLLBACK TO SAVEPOINT unknown_predecessor')
 expect((await db.query<{row:unknown}>('SELECT to_jsonb(p) row FROM pg_proc p WHERE oid=$1::regprocedure',[signature])).rows[0].row).toEqual(before)
})
it('a capture outside the two recognized bodies fails before guard installation',()=>{
 const actual=definition('gridex_ediel_technical_ack.require_contrl_v1'),body=functionBody(actual)
 const unknown=actual.replace(body,()=>body+'\n-- unrecognized capture\n')
 expect(()=>closedEpochDefinition(unknown,epoch)).toThrow('closed_capture_epoch_unrecognized')
})
})
