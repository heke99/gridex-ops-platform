import {buildTgtDateEventSource,assertTgtDateEventSelection} from './tgtDateEventSource'
import type {ProdatDateEventRoute} from '@/lib/ediel/prodat/prodatDateEvents'
import {assertTgtInvoiceeSource} from './tgtInvoiceeSource'
import {END_USER_ADDRESS_CODES} from '@/lib/ediel/prodat/prodatEndUserAddress'
import {tgtEndUserAddressSourceLines} from './tgtEndUserAddressSource'
import { createHash } from 'node:crypto'
import { copyProdatRegisterFacts } from '@/lib/ediel/prodat/prodatRegisterEvidence'
import type { ProdatDependentConditionFacts } from '@/lib/ediel/prodat/prodatDependentConditionEngine'
import type { EdielTestRunRow } from '@/lib/ediel/types'
import type { EdielTgtCaseTestData } from './tgtTestData'
import { groupTgtProdatSourceObjects, readTgtProdatSourceColumns } from './tgtProdatSource'

type Context = { dateEventRoute?:ProdatDateEventRoute; run: EdielTestRunRow; stepNo:number; code:string; testData:EdielTgtCaseTestData|null|undefined }
type SourceContext = Omit<Context,'run'> & {run:Pick<EdielTestRunRow,'id'|'company_id'|'role_code'|'test_case_code'|'test_suite'>}
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
function source(ctx:SourceContext) {
  if (!Number.isSafeInteger(ctx.stepNo) || ctx.stepNo<1 || !ctx.testData || ctx.testData.suite!==ctx.run.test_suite || ctx.testData.roleCode!==ctx.run.role_code || ctx.testData.testCaseCode!==ctx.run.test_case_code) return invalid()
  const columns=readTgtProdatSourceColumns(ctx.testData,ctx.code)
  const objects=groupTgtProdatSourceObjects(columns)
  if (!objects.length || objects.some(rows=>!rows[0].fields['209'])) return invalid()
  return {objects,digest:digest(columns.map(row=>({groupIndex:row.groupIndex,source:row.group.block,column:row.column,rawFields:row.rawFields})))}
}
function checkedFacts(ctx:SourceContext,value:unknown):ProdatDependentConditionFacts {
  const facts=copyProdatRegisterFacts(value)
  const {objects}=source(ctx)
  // Scope must be explicit for every source object. A global boolean cannot
  // stand in for a decision about B merely because A was configured.
  if (facts.registerObjects || ['Z04','Z06','Z10'].includes(ctx.code)) {
  if (!facts.registerObjects || facts.registerObjects.length!==objects.length) return invalid()
  for (const rows of objects) {
    const first=rows[0], id=first.fields['209'], agency=first.identityAgency ?? '9'
    const matches=facts.registerObjects.filter(fact=>fact.meteringPointId===id && fact.identityAgency===agency)
    if (matches.length!==1 || matches[0].expectedRegisterCount!==rows.length) return invalid()
  }
  }
  if(facts.endUserAddressObjects) {
    if(!END_USER_ADDRESS_CODES.includes(ctx.code))return invalid()
    for(const fact of facts.endUserAddressObjects) {
      const rows=objects.find(rows=>rows[0].fields['209']===fact.meteringPointId && (rows[0].identityAgency??'9')===fact.identityAgency)
      if(!rows || rows[0].fields['227']!==fact.endUser.id)return invalid()
      const first=rows[0],lines=tgtEndUserAddressSourceLines(first)
      if(fact.availability==='available' && (!lines.some(v=>v && v!=='.') || [0,1,2].some(i=>(lines[i]??'')!==(fact.addressLines[i]??''))))return invalid()
      if(fact.availability==='unavailable' && lines.some(Boolean))return invalid()
      if(first.fields['227.QUALIFIER']!==undefined && first.fields['227.QUALIFIER']!==fact.endUser.qualifier)return invalid()
      if(first.fields['227.AGENCY']!==undefined && first.fields['227.AGENCY']!==fact.endUser.agency)return invalid()
    }
  }
  assertTgtInvoiceeSource(ctx.code,objects,facts.invoiceeObjects)
  assertTgtDateEventSelection(ctx.code,objects,facts)
  return facts
}
/** Factual operator assertion, not a certification flag or authentication token.
 * Called only after the server has authorized the run's company. Existing notes
 * are retained; no migration or alternate rule store is introduced. */
export function buildTgtRegisterFactNotes(ctx:Context & {facts:unknown;actorId:string;sourceNote:string}):string {
  if (!ctx.actorId.trim() || !ctx.sourceNote.trim() || ctx.sourceNote.length>2000) return invalid()
  const raw=notes(ctx.run)
  const previous=envelope(ctx.run,raw)
  const operator=record(ctx.facts)
  if(operator?.dateEventSource!==undefined||operator?.dateEventObjects!==undefined&&['source','kind','environment','route','authority','testSubstitution','isAuthorized'].some(key=>Object.hasOwn(operator,key)))return invalid()
  const facts=checkedFacts(ctx,ctx.facts)
  if(facts.dateEventObjects){
    if(!ctx.dateEventRoute)return invalid()
    facts.dateEventSource=buildTgtDateEventSource({run:ctx.run,stepNo:ctx.stepNo,code:ctx.code,sourceDigest:source(ctx).digest,actorId:ctx.actorId,reference:ctx.sourceNote.trim(),route:ctx.dateEventRoute,facts})
  }
  if(facts.endUserAddressObjects) facts.endUserAddressObjects=facts.endUserAddressObjects.map(fact=>({...fact,source:{kind:'tgt',companyId:ctx.run.company_id,runId:ctx.run.id,stepNo:ctx.stepNo,code:ctx.code,sourceDigest:source(ctx).digest,reference:ctx.sourceNote.trim()}}))
  if(facts.invoiceeObjects)facts.invoiceeObjects=facts.invoiceeObjects.map(fact=>({...fact,source:{kind:'tgt',companyId:ctx.run.company_id,runId:ctx.run.id,stepNo:ctx.stepNo,code:ctx.code,sourceDigest:source(ctx).digest,reference:ctx.sourceNote.trim()}}))
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
  const facts=checkedFacts(ctx,entry.facts)
  if(facts.dateEventObjects||facts.dateEventSource){
    if(!ctx.dateEventRoute||facts.dateEventSource?.kind!=='tgt')return invalid()
    const expected=buildTgtDateEventSource({run:ctx.run,stepNo:ctx.stepNo,code:ctx.code,sourceDigest:source(ctx).digest,actorId:entry.actorId,reference:entry.sourceNote.trim(),route:ctx.dateEventRoute,facts})
    if(JSON.stringify(expected)!==JSON.stringify(facts.dateEventSource))return invalid()
  }
  for(const fact of [...facts.endUserAddressObjects??[],...facts.invoiceeObjects??[]])if(fact.source.kind!=='tgt' || fact.source.companyId!==ctx.run.company_id || fact.source.runId!==ctx.run.id || fact.source.stepNo!==ctx.stepNo || fact.source.code!==ctx.code || fact.source.sourceDigest!==source(ctx).digest)return invalid()
  return facts
}

/** Recheck source selection at the draft boundary after notes have been read.
 * Scope comes from the authorized build context, never from the fact itself. */
export function assertTgtAddressFactSource(input:{companyId:string;runId?:string|null;stepNo:number;code:string;roleCode:EdielTestRunRow['role_code'];caseCode:string;suite:EdielTestRunRow['test_suite'];testData:EdielTgtCaseTestData|null|undefined;facts:ProdatDependentConditionFacts|undefined}) {
  if(!input.facts?.endUserAddressObjects?.length&&!input.facts?.invoiceeObjects?.length&&!input.facts?.dateEventObjects?.length)return
  if(!input.runId)return invalid()
  const ctx:SourceContext={stepNo:input.stepNo,code:input.code,testData:input.testData,run:{id:input.runId,company_id:input.companyId,role_code:input.roleCode,test_case_code:input.caseCode,test_suite:input.suite}}
  const facts=checkedFacts(ctx,input.facts), selected=source(ctx)
  if(facts.dateEventObjects){const dateSource=facts.dateEventSource;if(dateSource?.kind!=='tgt'||dateSource.companyId!==input.companyId||dateSource.runId!==input.runId||dateSource.stepNo!==input.stepNo||dateSource.code!==input.code||dateSource.roleCode!==input.roleCode||dateSource.caseCode!==input.caseCode||dateSource.suite!==input.suite||dateSource.sourceDigest!==selected.digest)return invalid()}
  for(const fact of [...facts.endUserAddressObjects??[],...facts.invoiceeObjects??[]])if(fact.source.kind!=='tgt' || fact.source.companyId!==input.companyId || fact.source.runId!==input.runId || fact.source.stepNo!==input.stepNo || fact.source.code!==input.code || fact.source.sourceDigest!==selected.digest)return invalid()
}

/** Selects the resolver only; readTgtRegisterFacts still authenticates the complete envelope. */
export function tgtHasDateEventFacts(run:EdielTestRunRow,stepNo:number):boolean {
 const entry=record(envelope(run,notes(run))?.steps[String(stepNo)]),facts=record(entry?.facts)
 return !!facts&&(Object.hasOwn(facts,'dateEventObjects')||Object.hasOwn(facts,'dateEventSource'))
}
