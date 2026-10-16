// masterplan: SC-014
// require_contrl_v1 proves one inbound original per CONTRL first14 UCI
// projection, globally. Before 20261016100000 its candidate filter scanned the
// raw_payload of every inbound message of every tenant (0.7 s at 348, 2.5 s at
// 3,348 inbound messages per ACK read; 8 s at ~12k). Candidates now come from
// an expression index on the envelope projection the guard itself compares.
// The captured guard, lexer and envelope run unchanged in PostgreSQL; the
// source basis and endpoint readers are finite ports as in
// ediel-technical-ack-long-reference-prefix.test.ts.
import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {PGlite} from '@electric-sql/pglite'
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it} from 'vitest'

const schema=readFileSync(resolve('supabase/schema.sql'),'utf8')
const migration=readFileSync(resolve('supabase/migrations/20261016100000_ediel_technical_ack_original_uniqueness_indexed.sql'),'utf8')
const signature='gridex_ediel_technical_ack.require_contrl_v1(public.ediel_messages)'
const id=(n:number)=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`
const company=id(1),foreign=id(2),sourceId=id(10),ackId=id(11),prefix='ABCDEFGHIJKLMN'
type Envelope={sender:string[];receiver:string[];interchangeReference:string;uciReference:string;applicationReference:string;environment:string;testIndicator:string}
const needle=migration.match(/needle CONSTANT text:=\$n\$([\s\S]*?)\$n\$/)?.[1]
const replacement=migration.match(/replacement CONSTANT text:=\$r\$([\s\S]*?)\$r\$/)?.[1]
function definition(name:string){
 const start=schema.indexOf('CREATE FUNCTION '+name+'(')
 if(start<0)throw Error('actual_function_missing:'+name)
 const rest=schema.slice(start),delimiter=rest.match(/AS (\$[^$]*\$)/)?.[1]
 if(!delimiter)throw Error('actual_function_body_missing:'+name)
 return rest.slice(0,rest.indexOf(delimiter+';',rest.indexOf(delimiter)+delimiter.length)+delimiter.length+1)
}
// The predecessor body, whether schema.sql already carries this forward or not.
function predecessor(){
 const actual=definition('gridex_ediel_technical_ack.require_contrl_v1')
 if(!needle||!replacement)throw Error('forward_transform_unavailable')
 if(actual.split(needle).length===2)return actual
 if(actual.split(replacement).length===2)return actual.replace(replacement,()=>needle)
 throw Error('captured_guard_unrecognized')
}
function wire(reference:string,options:{advice?:string;separator?:string;terminator?:string;sender?:string;receiver?:string;application?:string;test?:boolean}={}){
 const {advice='',separator:s='+',terminator:t="'",sender='12345:14',receiver='54321:14',application='23-DGI-PRODAT',test=false}=options
 return advice+`UNB${s}UNOC:3${s}${sender}${s}${receiver}${s}261001:1200${s}${reference}${s}${s}${application}${s}${s}1${s}${s}${test?'1':''}${t}UNH${s}1${s}PRODAT:D:97A:UN:E2SE6A${t}UNT${s}2${s}1${t}UNZ${s}1${s}${reference}${t}`
}
const long=()=>wire(prefix+'123456')
const variants:[string,()=>string][]=[
 ['plain20',long],['default release',()=>long().replaceAll('+'+prefix,'+?'+prefix)],
 ['LF framing',()=>long().replaceAll(prefix,prefix.slice(0,6)+'\n'+prefix.slice(6))],
 ['CRLF framing',()=>long().replaceAll(prefix,prefix.slice(0,6)+'\r\n'+prefix.slice(6))],
 ['custom release',()=>wire(prefix+'123456',{advice:"UNA:+.! '"}).replaceAll('+'+prefix,'+!'+prefix)],
 ['custom separators',()=>wire(prefix+'123456',{advice:'UNA:*.? ~',separator:'*',terminator:'~'})],
]

describe.each(['predecessor','indexed'] as const)('CONTRL original uniqueness (%s)',epoch=>{
let db:PGlite
beforeAll(async()=>{
 db=new PGlite()
 await db.exec(`CREATE SCHEMA gridex_utilts_binding;CREATE SCHEMA gridex_ediel_technical_ack;
 CREATE TABLE public.ediel_messages(id uuid PRIMARY KEY,company_id uuid,environment text,direction text,message_family text,related_message_id uuid,raw_payload text);
 CREATE TABLE public.probe_captured_basis(company_id uuid,source_id uuid,payload_hash text,evidence jsonb);
 CREATE FUNCTION gridex_ediel_technical_ack.require_source_v1(c uuid,s uuid) RETURNS jsonb LANGUAGE plpgsql AS $$DECLARE result jsonb;BEGIN
 SELECT b.evidence INTO result FROM public.probe_captured_basis b JOIN public.ediel_messages m ON m.id=b.source_id AND m.direction='inbound'
 WHERE b.company_id=c AND b.source_id=s AND b.payload_hash=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex');
 IF result IS NULL THEN RAISE EXCEPTION 'finite_captured_basis_unavailable';END IF;RETURN result;END$$;
 CREATE FUNCTION gridex_ediel_technical_ack.require_current_endpoint_v1(jsonb) RETURNS void LANGUAGE plpgsql AS $$BEGIN END$$;
 CREATE FUNCTION gridex_ediel_technical_ack.retained_source_v1(public.ediel_messages,boolean) RETURNS uuid LANGUAGE plpgsql AS $$BEGIN
 RAISE EXCEPTION 'finite_retained_reader_not_selected';END$$;`)
 await db.exec(definition('gridex_utilts_binding.wire_tokens_v1'))
 await db.exec(definition('gridex_ediel_technical_ack.envelope'))
 await db.exec(predecessor())
 if(epoch==='indexed')await db.exec(migration)
},30_000)
beforeEach(async()=>{await db.exec('BEGIN')})
afterEach(async()=>{await db.exec('ROLLBACK')})
afterAll(async()=>{await db?.close()})
async function addSource(raw:string,n=10,tenant=company){
 await db.query('INSERT INTO ediel_messages(id,company_id,environment,direction,message_family,raw_payload) VALUES($1,$2,$3,$4,$5,$6)',[id(n),tenant,'production','inbound','PRODAT',raw])
}
async function admitted(raw:string){
 await addSource(raw)
 const envelope=(await db.query<{e:Envelope}>('SELECT gridex_ediel_technical_ack.envelope($1) e',[raw])).rows[0].e
 const evidence={companyId:company,environment:envelope.environment,syntaxDecision:'accepted',originalUNB:envelope}
 await db.query(`INSERT INTO probe_captured_basis VALUES($1,$2,encode(sha256(convert_to($3,'UTF8')),'hex'),$4)`,[company,sourceId,raw,evidence])
 return {envelope,evidence}
}
function ack(envelope:Envelope){
 const payload=`UNB+UNOC:3+${envelope.receiver.join(':')}+${envelope.sender.join(':')}+261001:1200+ACK++${envelope.applicationReference}++++${envelope.testIndicator}'UNH+A+CONTRL:2:2:UN'UCI+${envelope.uciReference.replaceAll('?','??').replaceAll('+','?+')}+${envelope.sender.join(':')}+${envelope.receiver.join(':')}+1'UNT+3+A'UNZ+1+ACK'`
 return {id:ackId,company_id:company,environment:envelope.environment,direction:'outbound',message_family:'CONTRL',related_message_id:sourceId,raw_payload:payload}
}
const guard=async(envelope:Envelope)=>(await db.query<{e:unknown}>(`SELECT gridex_ediel_technical_ack.require_contrl_v1(jsonb_populate_record(NULL::public.ediel_messages,$1)) e`,[ack(envelope)])).rows[0].e

it.each(variants)('qualifies the sole %s original',async(_name,make)=>{
 const {envelope,evidence}=await admitted(make())
 expect(await guard(envelope)).toEqual(evidence)
})
it.each(variants)('a foreign %s original with the same first14 stays globally ambiguous',async(_name,make)=>{
 const {envelope}=await admitted(wire(prefix))
 await addSource(make(),20,foreign)
 await expect(guard(envelope)).rejects.toThrow('ediel_technical_ack_original_ambiguous')
})
it.each([[prefix],['I'],['AB?+CDEFGHIJKLMN123456']])('reference %s: unrelated noise is ignored and a same-reference duplicate is ambiguous',async(reference)=>{
 const {envelope,evidence}=await admitted(wire(reference))
 for(let i=0;i<50;i++)await addSource(wire('I'+String(i).padStart(19,'0')),100+i,foreign)
 expect(await guard(envelope)).toEqual(evidence)
 await addSource(wire(reference),20,foreign)
 await expect(guard(envelope)).rejects.toThrow('ediel_technical_ack_original_ambiguous')
})
it.each([
 ['sender',wire(prefix+'654321',{sender:'99999:14'})],['receiver',wire(prefix+'654321',{receiver:'99999:14'})],
 ['application',wire(prefix+'654321',{application:'OTHER'})],['environment',wire(prefix+'654321',{test:true})],
 ['prefix elsewhere',wire('OTHER').replace('23-DGI-PRODAT',prefix)],['malformed envelope',"UNB+UNOC:3+12345:14+54321:14+261001:1200+"+prefix],
])('a candidate with different %s does not count',async(_name,other)=>{
 const {envelope,evidence}=await admitted(wire(prefix));await addSource(other,20,foreign)
 expect(await guard(envelope)).toEqual(evidence)
})
it('the outbound CONTRL itself is never counted as an original',async()=>{
 const {envelope,evidence}=await admitted(wire(prefix))
 const row=ack(envelope)
 await db.query('INSERT INTO ediel_messages(id,company_id,environment,direction,message_family,raw_payload,related_message_id) VALUES($1,$2,$3,$4,$5,$6,$7)',[id(30),company,'production','outbound','CONTRL',row.raw_payload,sourceId])
 expect(await guard(envelope)).toEqual(evidence)
})
if(epoch==='indexed'){
 it('draws candidates from the inbound envelope index instead of scanning payloads',async()=>{
  const body=(await db.query<{prosrc:string}>('SELECT prosrc FROM pg_proc WHERE oid=$1::regprocedure',[signature])).rows[0].prosrc
  expect(body).not.toContain('strpos(translate(o.raw_payload')
  const start=body.indexOf("SELECT o.* FROM public.ediel_messages o WHERE o.direction='inbound'"),end=body.indexOf(' OFFSET 0) old',start)
  const candidates=body.slice(start,end).replace('o.*','o.id').replaceAll('evidence#','$1::jsonb#')
  await db.exec('SET LOCAL enable_seqscan=off')
  const plan=(await db.query<{'QUERY PLAN':string}>('EXPLAIN '+candidates,[{originalUNB:{uciReference:prefix}}])).rows.map(r=>r['QUERY PLAN']).join('\n')
  expect(plan).toContain('ediel_messages_inbound_envelope_uci_idx')
 })
 it('reapplying the forward is refused without changing the guard',async()=>{
  const before=(await db.query<{row:unknown}>('SELECT to_jsonb(p) row FROM pg_proc p WHERE oid=$1::regprocedure',[signature])).rows[0].row
  await db.exec('SAVEPOINT again')
  await expect(db.exec(migration)).rejects.toThrow('technical_ack_original_uniqueness_predecessor_required')
  await db.exec('ROLLBACK TO SAVEPOINT again')
  expect((await db.query<{row:unknown}>('SELECT to_jsonb(p) row FROM pg_proc p WHERE oid=$1::regprocedure',[signature])).rows[0].row).toEqual(before)
 })
}
})
