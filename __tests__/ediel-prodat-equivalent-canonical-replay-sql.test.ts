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
let f:Fixture,first:Receipt,before:Record<string,unknown>
beforeAll(async()=>{
 const module=await import(/* @vite-ignore */ pathToFileURL(resolve('scripts/ediel-prodat-equivalent-canonical-replay-sql-regression.mjs')).href) as {createReplayFixture:()=>Promise<Fixture>}
 f=await module.createReplayFixture()
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
 expect(await f.run()).toEqual(first)
 expect(await f.snapshot()).toEqual(before)
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
