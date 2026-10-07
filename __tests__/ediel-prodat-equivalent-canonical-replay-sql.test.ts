// masterplan: AT-Z14V-ESCO
// Actual immutable V6/V3/V2 SQL; declared canonical/registry/legal admission IO.
// Mechanical finite proof only. Native admission and two-session PG17 locks
// remain separate required evidence; no caller facts establish market authority.
import {readFileSync,existsSync} from 'node:fs'
import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import type {PGlite} from '@electric-sql/pglite'
import {afterAll,afterEach,beforeAll,beforeEach,expect,it} from 'vitest'

type Receipt={assessmentId:string;version:number;companyId:string;environment:string;sourceMessageId:string;sourcePayloadHash:string;factsHash:string;sourceDisposition:string;ignoredFieldsHash:string|null;objectFactsHash:string|null;responseFactsHash:string|null;applicationFactsHash:string|null;sourceFunctionFactsHash:string|null}
type Fixture={db:PGlite;args:(string|null)[];fullArgs:(string|null)[];run:(args?:(string|null)[])=>Promise<Receipt>;snapshot:()=>Promise<Record<string,unknown>>;id:(n:number)=>string;digest:(s:string)=>string;signature:string;forward:string}
let f:Fixture,first:Receipt,before:Record<string,unknown>,catalogBefore:unknown,wrapperBefore:unknown
const body=async()=>(await f.db.query<{prosrc:string}>('SELECT prosrc FROM pg_proc WHERE oid=to_regprocedure($1)',[f.signature])).rows[0].prosrc
const catalog=async()=>(await f.db.query<{x:unknown}>("SELECT to_jsonb(p)-'prosrc' x FROM pg_proc p WHERE oid=to_regprocedure($1)",[f.signature])).rows[0].x
const wrapper=async()=>(await f.db.query<{x:unknown}>('SELECT to_jsonb(p) x FROM pg_proc p WHERE oid=to_regprocedure($1)',['public.gridex_record_prodat_source_validation_v6(uuid,text,uuid,text,text,text,text,text,text,text)'])).rows[0].x
const forwardSql=()=>{expect(existsSync(f.forward),'SETUP_GAP: planned production forward is not authored').toBe(true);return readFileSync(f.forward,'utf8').replace(/^BEGIN;$/m,'').replace(/^COMMIT;$/m,'')}
const facetTables=[['prodat_ignored_field_facets','canonical_assessment_id','fields_text','fields_hash'],['prodat_object_validation_facets','assessment_id','facts_text','facts_hash'],['prodat_response_facets','assessment_id','response_facts_text','response_facts_hash'],['prodat_application_facets','assessment_id','application_facts_text','application_facts_hash'],['prodat_source_function_facets','assessment_id','function_facts_text','function_facts_hash']] as const
beforeAll(async()=>{
 const fixtureModule=await import(/* @vite-ignore */ pathToFileURL(resolve('scripts/ediel-prodat-equivalent-canonical-replay-sql-regression.mjs')).href) as {createReplayFixture:()=>Promise<Fixture>}
 f=await fixtureModule.createReplayFixture()
 catalogBefore=await catalog();wrapperBefore=await wrapper()
 // Production forward is absent during test-first RED; existing behavior still
 // executes. Once authorized source exists, this same test loads its real SQL.
 if(existsSync(f.forward))await f.db.exec(readFileSync(f.forward,'utf8'))
 const run=f.run
 // Preserve the real statement refusal while recovering the declared caller's
 // transaction so post-failure immutable-row snapshots can be inspected.
 f.run=async args=>{await f.db.exec('SAVEPOINT declared_call');try{const result=await run(args);await f.db.exec('RELEASE SAVEPOINT declared_call');return result}catch(error){await f.db.exec('ROLLBACK TO SAVEPOINT declared_call; RELEASE SAVEPOINT declared_call');throw error}}
},30000)
beforeEach(async()=>{await f.db.exec('BEGIN');first=await f.run();before=await f.snapshot()})
afterEach(async()=>{await f.db.exec('ROLLBACK')})
afterAll(async()=>{await f?.db.close()})

it('an identical accepted replay returns the exact same receipt and no new assessment/facet/custody rows',async()=>{
 const callsBefore=(await f.db.query<{last_value:number}>('SELECT last_value FROM public.declared_canonical_validator_calls')).rows[0].last_value
 expect(await f.run()).toEqual(first)
 expect(await f.snapshot()).toEqual(before)
 expect(Number((await f.db.query<{last_value:number}>('SELECT last_value FROM public.declared_canonical_validator_calls')).rows[0].last_value)).toBe(Number(callsBefore)+1)
})
it('a complete accepted six-text replay includes the real committed source-function validator and preserves its leaf',async()=>{
 const receipt=await f.run(f.fullArgs),stable=await f.snapshot()
 expect(receipt.sourceFunctionFactsHash).toBe(f.digest(f.fullArgs[9]!))
 expect(await f.run(f.fullArgs)).toEqual(receipt)
 expect(await f.snapshot()).toEqual(stable)
})
it('NULL optional facets compare exactly and cannot cause an equivalent replay to append',async()=>{
 const args=[...f.args];args.fill(null,5)
 const receipt=await f.run(args),stable=await f.snapshot()
 expect(receipt).toMatchObject({ignoredFieldsHash:null,objectFactsHash:null,responseFactsHash:null,applicationFactsHash:null,sourceFunctionFactsHash:null})
 expect(await f.run(args)).toEqual(receipt)
 expect(await f.snapshot()).toEqual(stable)
})
it.each([4,5,6,7,8,9])('changed exact text at argument %s makes a genuine new leaf, even when JSON meaning is unchanged',async index=>{
 const original=await f.run(f.fullArgs),args=[...f.fullArgs]
 args[index]=` ${args[index]} `
 const next=await f.run(args)
 expect(next.assessmentId).not.toBe(original.assessmentId)
 const rows=await f.db.query<{previous_assessment_id:string}>('SELECT previous_assessment_id FROM gridex_received_sources.validation_assessments WHERE id=$1',[next.assessmentId])
 expect(rows.rows[0].previous_assessment_id).toBe(original.assessmentId)
})
it.each(['original_bytes','canonical_registry'])('an equivalent replay still executes the current %s finite admission guard and propagates its refusal',async name=>{
 await f.db.query('UPDATE public.declared_current_guards SET allowed=false WHERE name=$1',[name])
 const stable=await f.snapshot()
 await expect(f.run()).rejects.toThrow(name==='original_bytes'?'declared_original_bytes_unavailable':'declared_current_registry_refusal')
 expect(await f.snapshot()).toEqual(stable)
})
it('actual V2 ignored-field physical validation rejects changed evidence and leaves every ledger unchanged',async()=>{
 const args=[...f.args];args[5]=JSON.stringify([{fieldNumber:'260',sourceRule:'PRODAT26A:P119',occurrence:{scope:'object',messageReference:'M',lineIndex:0,lineNumber:'2',objectId:'735123456789012345',identityAgency:'9'}}])
 await expect(f.run(args)).rejects.toThrow('prodat_ignored_field_physical_scope_invalid')
 expect(await f.snapshot()).toEqual(before)
})
it.each(['prodat_application_facets','prodat_source_function_facets'])('a final real %s insert failure on identical replay is never swallowed',async table=>{
 const args=table==='prodat_source_function_facets'?f.fullArgs:f.args
 if(table==='prodat_source_function_facets')await f.run(args)
 await f.db.exec(`ALTER TABLE gridex_received_sources.${table} ADD CONSTRAINT declared_last_facet_failure CHECK(false) NOT VALID`)
 const stable=await f.snapshot()
 await expect(f.run(args)).rejects.toThrow('declared_last_facet_failure')
 expect(await f.snapshot()).toEqual(stable)
})
it('changed then reverted facts create a new current leaf and never resurrect the first ancestor (ABA)',async()=>{
 const changed=[...f.args];changed[4]=` ${changed[4]} `
 const middle=await f.run(changed),last=await f.run()
 expect(last.assessmentId).not.toBe(first.assessmentId);expect(last.assessmentId).not.toBe(middle.assessmentId)
 expect((await f.db.query<{previous_assessment_id:string}>('SELECT previous_assessment_id FROM gridex_received_sources.validation_assessments WHERE id=$1',[last.assessmentId])).rows[0].previous_assessment_id).toBe(middle.assessmentId)
 const stable=await f.snapshot();expect(await f.run()).toEqual(last);expect(await f.snapshot()).toEqual(stable)
})
it.each(['syntaxDecision','applicationDecision','functionalDecision'])('an identical nonaccepted %s result cannot reuse a previous assessment',async decision=>{
 const args=[...f.args];args.fill(null,5)
 const facts=JSON.parse(args[4]!);facts[decision]='manual_review';facts.reasonCodes=['DECLARED_NONACCEPTED'];args[4]=JSON.stringify(facts)
 const prior=await f.run(args),next=await f.run(args)
 expect(next.assessmentId).not.toBe(prior.assessmentId)
})
it('two actual current leaves cannot select an arbitrary prior receipt for equivalent reuse',async()=>{
 await f.db.query('INSERT INTO gridex_received_sources.validation_assessments SELECT $1,source_message_id,company_id,environment,source_payload_hash,facts_text,facts_hash,previous_assessment_id,owner FROM gridex_received_sources.validation_assessments WHERE id=$2',[f.id(500),first.assessmentId])
 const result=await f.run();expect([first.assessmentId,f.id(500)]).not.toContain(result.assessmentId)
})
it('a corrupted stored canonical hash is not a reusable candidate',async()=>{
 await f.db.query('UPDATE gridex_received_sources.validation_assessments SET facts_hash=$1 WHERE id=$2',['f'.repeat(64),first.assessmentId])
 expect((await f.run()).assessmentId).not.toBe(first.assessmentId)
})
it.each(facetTables)('a missing %s row cannot supply equivalent complete evidence',async(table,key)=>{
 const prior=await f.run(f.fullArgs)
 // Controlled catalog-damage fixture, under DB owner, not a lawful public
 // operation or admitted authority. Real immutable triggers remain production.
 await f.db.exec(`ALTER TABLE gridex_received_sources.${table} DISABLE TRIGGER USER`)
 await f.db.query(`DELETE FROM gridex_received_sources.${table} WHERE ${key}=$1`,[prior.assessmentId])
 const result=await f.run(f.fullArgs);expect(result.assessmentId).not.toBe(prior.assessmentId)
})
it.each(facetTables)('a corrupted stored %s hash is checked rather than trusted',async(table,key,_text,hash)=>{
 const prior=await f.run(f.fullArgs)
 await f.db.exec(`ALTER TABLE gridex_received_sources.${table} DISABLE TRIGGER USER`)
 const constraints=await f.db.query<{conname:string}>("SELECT conname FROM pg_constraint WHERE conrelid=$1::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%sha256%'",[`gridex_received_sources.${table}`])
 for(const {conname} of constraints.rows)await f.db.exec(`ALTER TABLE gridex_received_sources.${table} DROP CONSTRAINT "${conname.replaceAll('"','""')}"`)
 await f.db.query(`UPDATE gridex_received_sources.${table} SET ${hash}=$1 WHERE ${key}=$2`,['f'.repeat(64),prior.assessmentId])
 expect((await f.run(f.fullArgs)).assessmentId).not.toBe(prior.assessmentId)
})
it.each(['company_id','environment','source_payload_hash'])('same facet text with mismatched %s custody cannot be reused',async column=>{
 await f.db.exec('ALTER TABLE gridex_received_sources.prodat_object_validation_facets DISABLE TRIGGER USER')
 const value=column==='company_id'?f.id(99):column==='environment'?'production':'e'.repeat(64)
 if(column==='company_id')await f.db.query('INSERT INTO public.companies VALUES($1)',[value])
 await f.db.query(`UPDATE gridex_received_sources.prodat_object_validation_facets SET ${column}=$1 WHERE assessment_id=$2`,[value,first.assessmentId])
 expect((await f.run()).assessmentId).not.toBe(first.assessmentId)
})
it.each([5,6,7,8,9])('nullable facet argument %s presence is exact, not a wildcard',async index=>{
 const prior=await f.run(f.fullArgs),args=[...f.fullArgs];args[index]=null
 // SOURCE-FUNCTION plus no APP is rightly refused by its real validator;
 // this test must not invent a valid nullable combination for that owner.
 if(index===8){const stable=await f.snapshot();await expect(f.run(args)).rejects.toThrow('prodat_source_function_same_owner_required');expect(await f.snapshot()).toEqual(stable)}
 else expect((await f.run(args)).assessmentId).not.toBe(prior.assessmentId)
})
it('the actual public wrapper still refuses an ordinary role before admission',async()=>{
 await f.db.exec('SAVEPOINT ordinary_role; SET ROLE authenticated')
 try{await expect(f.db.query('SELECT public.gridex_record_prodat_source_validation_v6(NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL)')).rejects.toThrow(/permission|received_evidence_service_required/)}
 finally{await f.db.exec('ROLLBACK TO SAVEPOINT ordinary_role; RELEASE SAVEPOINT ordinary_role')}
 expect(await f.snapshot()).toEqual(before)
})
it('a delegate using the same rollback code/message is rethrown without the private completion flag',async()=>{
 await f.db.exec(`CREATE OR REPLACE FUNCTION gridex_received_sources.append_validation(c uuid,env text,source_id uuid,source_hash text,facts text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN RAISE EXCEPTION 'ediel_equivalent_prodat_canonical_replay_rollback' USING ERRCODE='GX001';END$$;`)
 const stable=await f.snapshot()
 await expect(f.run()).rejects.toMatchObject({code:'GX001',message:'ediel_equivalent_prodat_canonical_replay_rollback'})
 expect(await f.snapshot()).toEqual(stable)
})
it('the actual private full catalog and entire public wrapper survive the forward',async()=>{
 expect(await catalog()).toEqual(catalogBefore);expect(await wrapper()).toEqual(wrapperBefore)
})
it('replaying the real forward preserves its exact body/catalog/wrapper',async()=>{
 const text=await body(),privateMetadata=await catalog(),publicMetadata=await wrapper()
 await f.db.exec(forwardSql())
 expect(await body()).toBe(text);expect(await catalog()).toEqual(privateMetadata);expect(await wrapper()).toEqual(publicMetadata)
})
it('the real forward refuses an unrecognized predecessor without changing it or its metadata',async()=>{
 const old=await body(),changed=old+'\n-- declared unrecognized predecessor\n'
 const definition=(await f.db.query<{x:string}>('SELECT pg_get_functiondef(to_regprocedure($1)) x',[f.signature])).rows[0].x
 await f.db.exec(definition.replace(old,()=>changed))
 const privateMetadata=await catalog(),publicMetadata=await wrapper()
 await f.db.exec('SAVEPOINT unknown_predecessor')
 try{await expect(f.db.exec(forwardSql())).rejects.toThrow(/predecessor_unrecognized/)}
 finally{await f.db.exec('ROLLBACK TO SAVEPOINT unknown_predecessor; RELEASE SAVEPOINT unknown_predecessor')}
 expect(await body()).toBe(changed);expect(await catalog()).toEqual(privateMetadata);expect(await wrapper()).toEqual(publicMetadata)
})
