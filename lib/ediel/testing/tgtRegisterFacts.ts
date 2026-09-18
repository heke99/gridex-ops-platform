import { createHash } from 'node:crypto'
import { copyProdatRegisterFacts } from '@/lib/ediel/prodat/prodatRegisterEvidence'
import type { ProdatDependentConditionFacts } from '@/lib/ediel/prodat/prodatDependentConditionEngine'
import type { EdielTestRunRow } from '@/lib/ediel/types'
import type { EdielTgtCaseTestData } from './tgtTestData'
import { groupTgtProdatSourceObjects, readTgtProdatSourceColumns } from './tgtProdatSource'

type Context = { run: EdielTestRunRow; stepNo:number; code:string; testData:EdielTgtCaseTestData|null|undefined }
type Entry = {code:string;sourceDigest:string;facts:ProdatDependentConditionFacts;actorId:string;sourceNote:string;recordedAt:string}
type FactNotes = {version:1;companyId:string;runId:string;roleCode:string;caseCode:string;suite:string;steps:Record<string,Entry>}
const invalid=():never=>{throw new Error('PRODAT_REGISTER_SOURCE_EVIDENCE_INVALID')}
const record=(value:unknown):Record<string,unknown>|null=>value && typeof value==='object' && !Array.isArray(value) ? value as Record<string,unknown> : null
const sort=(value:unknown):unknown=>Array.isArray(value) ? value.map(sort) : record(value) ? Object.fromEntries(Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>[k,sort(v)])) : value
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(sort(value))).digest('hex')
function notes(run:EdielTestRunRow):Record<string,unknown> {
  if (!run.notes) return {}
  try { return record(JSON.parse(run.notes)) ?? {text:run.notes} } catch { return {text:run.notes} }
}
function envelope(run:EdielTestRunRow, raw:Record<string,unknown>):FactNotes|undefined {
  if (!Object.hasOwn(raw,'prodatRegisterFacts')) return undefined
  const value=record(raw.prodatRegisterFacts)
  if (!value || value.version!==1 || value.companyId!==run.company_id || value.runId!==run.id || value.roleCode!==run.role_code || value.caseCode!==run.test_case_code || value.suite!==run.test_suite || !record(value.steps)) return invalid()
  return value as FactNotes
}
function source(ctx:Context) {
  if (!Number.isSafeInteger(ctx.stepNo) || ctx.stepNo<1 || !ctx.testData || ctx.testData.roleCode!==ctx.run.role_code || ctx.testData.testCaseCode!==ctx.run.test_case_code) return invalid()
  const columns=readTgtProdatSourceColumns(ctx.testData,ctx.code)
  const objects=groupTgtProdatSourceObjects(columns)
  if (!objects.length || objects.some(rows=>!rows[0].fields['209'])) return invalid()
  return {objects,digest:digest(columns.map(row=>({groupIndex:row.groupIndex,source:row.group.block,column:row.column,rawFields:row.rawFields})))}
}
function checkedFacts(ctx:Context,value:unknown):ProdatDependentConditionFacts {
  const facts=copyProdatRegisterFacts(value)
  const {objects}=source(ctx)
  // Scope must be explicit for every source object. A global boolean cannot
  // stand in for a decision about B merely because A was configured.
  if (!facts.registerObjects || facts.registerObjects.length!==objects.length) return invalid()
  for (const rows of objects) {
    const first=rows[0], id=first.fields['209'], agency=first.identityAgency ?? '9'
    const matches=facts.registerObjects.filter(fact=>fact.meteringPointId===id && fact.identityAgency===agency)
    if (matches.length!==1 || matches[0].expectedRegisterCount!==rows.length) return invalid()
  }
  return facts
}
/** Factual operator assertion, not a certification flag or authentication token.
 * Called only after the server has authorized the run's company. Existing notes
 * are retained; no migration or alternate rule store is introduced. */
export function buildTgtRegisterFactNotes(ctx:Context & {facts:unknown;actorId:string;sourceNote:string}):string {
  if (!ctx.actorId.trim() || !ctx.sourceNote.trim() || ctx.sourceNote.length>2000) return invalid()
  const raw=notes(ctx.run)
  const previous=envelope(ctx.run,raw)
  const facts=checkedFacts(ctx,ctx.facts)
  const next:FactNotes=previous ?? {version:1,companyId:ctx.run.company_id,runId:ctx.run.id,roleCode:ctx.run.role_code,caseCode:ctx.run.test_case_code,suite:ctx.run.test_suite,steps:{}}
  const entry:Entry={code:ctx.code,sourceDigest:source(ctx).digest,facts,actorId:ctx.actorId,sourceNote:ctx.sourceNote.trim(),recordedAt:new Date().toISOString()}
  const result=JSON.stringify({...raw,prodatRegisterFacts:{...next,steps:{...next.steps,[ctx.stepNo]:entry}}})
  if (result.length>65536) return invalid()
  return result
}
/** Changing tenant, run, step function or original source invalidates the facts.
 * Missing evidence remains unknown; neither field values nor passing test labels
 * can establish whether readings are sent in UTILTS. */
export function readTgtRegisterFacts(ctx:Context):ProdatDependentConditionFacts|undefined {
  const value=envelope(ctx.run,notes(ctx.run))
  if (!value) return undefined
  const entry=record(value.steps[String(ctx.stepNo)])
  if (!entry) {
    if (Object.hasOwn(value.steps,String(ctx.stepNo))) return invalid()
    return undefined
  }
  if (entry.code!==ctx.code || entry.sourceDigest!==source(ctx).digest || typeof entry.actorId!=='string' || !entry.actorId.trim() || typeof entry.sourceNote!=='string' || !entry.sourceNote.trim()) return invalid()
  return checkedFacts(ctx,entry.facts)
}
