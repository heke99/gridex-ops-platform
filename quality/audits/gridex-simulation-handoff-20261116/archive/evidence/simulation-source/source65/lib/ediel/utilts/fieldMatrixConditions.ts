import { segmentComposite } from '@/lib/ediel/core/edifactTokenizer'
import type { EdifactServiceStringAdvice } from '@/lib/ediel/core/una'
import { findUtiltsTimeSeriesProducts, UTILTS_TSP_SOURCE, type UtiltsProductTuple, type UtiltsTimeSeriesProduct } from '@/lib/ediel/rulebook/utiltsTimeSeriesProductCatalogue'
import { selectUtiltsFieldRules, type SelectedUtiltsFieldRule, type UtiltsFieldMatrixPolicy } from './fieldMatrixProjection'
import { hasUtiltsFieldReader, observeUtiltsFieldScopes, readUtiltsFieldOccurrences, type UtiltsPhysicalScope, type UtiltsFieldOccurrence } from './fieldMatrixOccurrences'

export type UtiltsProductResolution =
  | {kind:'not_applicable'}
  | {kind:'absent'}
  | {kind:'incomplete'; missingFields:readonly string[]}
  | {kind:'malformed'; reason:string}
  | {kind:'unqualified'; tuple:UtiltsProductTuple}
  | {kind:'qualified'; tuple:UtiltsProductTuple; rows:readonly UtiltsTimeSeriesProduct[]}
type ScopeIdentity = Pick<UtiltsPhysicalScope,'messageIndex'|'transactionIndex'|'observationIndex'|'referenceNumber'>
export type UtiltsConditionDecision = ScopeIdentity & {
  fieldNo:string; semanticKey:string; ruleKey:string
  requirement:'required'|'forbidden'|'optional'; basis:'published_matrix'|'technical_catalogue'|'swedish_detail'
  sourceSha256:string; catalogueRows?:readonly number[]; catalogueSha256?:string; parentSegmentIndex?:number
}
export type UtiltsConditionIssue = UtiltsConditionDecision & {
  kind:'missing'|'forbidden'|'invalid'; code:string
  occurrence?:Pick<UtiltsFieldOccurrence,'segmentIndex'|'elementIndex'|'componentIndex'>
}
export type UtiltsConditionResult = {
  sourceQualified:boolean;complete:false;decisions:UtiltsConditionDecision[];issues:UtiltsConditionIssue[]
  transactions:(ScopeIdentity & {product:UtiltsProductResolution})[]
  holds:(ScopeIdentity & {reason:'product_catalogue_unqualified'|'source_unqualified'})[]
  unresolved:(Partial<ScopeIdentity> & {fieldNo?:string;ruleKey?:string;reason:string})[]
}
const categories = ['PC','PT','OT','LOD','BAP'] as const
/** PIA grammar is independent of catalogue membership. A missing mandatory value
 * is distinct from malformed supplied syntax and unknown catalogue membership. */
export function parseUtiltsTimeSeriesProduct(scope:UtiltsPhysicalScope,una:EdifactServiceStringAdvice):UtiltsProductResolution {
  const pias=scope.segments.filter(s=>s.tag==='PIA')
  if(!pias.length)return {kind:'absent'}
  if(pias.length!==1) return {kind:'malformed',reason:'exactly_one_PIA_required'}
  const pia=pias[0]
  if(segmentComposite(pia,1,una)[0]!=='1'||pia.elements.length>7) return {kind:'malformed',reason:'five_PIA_categories_required'}
  const values:string[]=[], missingFields:string[]=[]
  for(let index=2;index<=6;index++) {
    const c=segmentComposite(pia,index,una)
    // The five C212 positions are fixed on Swedish U5 p81 (511a..511e).
    // Empty mandatory data is missing (p124 "Ej blankt"), not an invalid code.
    if(index>=pia.elements.length||c.every(value=>!value.trim())) {
      missingFields.push(`511${String.fromCharCode(97+index-2)}`)
      values.push('')
      continue
    }
    if(c.length!==4||c[1]!==categories[index-2]||c[2]!=='SVK'||c[3]!=='260')return {kind:'malformed',reason:'invalid_or_out_of_order_PIA_category'}
    if(!c[0]?.trim())missingFields.push(`511${String.fromCharCode(97+index-2)}`)
    values.push(c[0])
  }
  if(missingFields.length)return {kind:'incomplete',missingFields}
  const tuple=values as unknown as UtiltsProductTuple
  const rows=findUtiltsTimeSeriesProducts(scope.messageCode??'',tuple)
  return rows.length?{kind:'qualified',tuple,rows}:{kind:'unqualified',tuple}
}
function identity(s:UtiltsPhysicalScope):ScopeIdentity {
  return {messageIndex:s.messageIndex,transactionIndex:s.transactionIndex,observationIndex:s.observationIndex,referenceNumber:s.referenceNumber}
}
const mappedIdentityFields=new Set(['209','533','260a','260b','260c','262','510','524','525','526'])
/** Partial Swedish U5 conditional authority. It never grants actor ownership,
 * product enablement, market authority or permission to consume an unresolved
 * transaction. Callers must enforce holds locally before business mutation. */
export function resolveUtiltsFieldConditions(input:{policy:UtiltsFieldMatrixPolicy;rawPayload:string}):UtiltsConditionResult {
  const result:UtiltsConditionResult={sourceQualified:false,complete:false,decisions:[],issues:[],transactions:[],holds:[],unresolved:[]}
  const rules=selectUtiltsFieldRules(input.policy)
  if(!rules.length) {result.holds.push({messageIndex:0,referenceNumber:null,reason:'source_unqualified'});return result}
  result.sourceQualified=true
  const physical=observeUtiltsFieldScopes(input.rawPayload)
  const bySemantic=(key:string)=>rules.find(r=>r.semanticKey===key)
  function apply(row:SelectedUtiltsFieldRule,scope:UtiltsPhysicalScope,requirement:UtiltsConditionDecision['requirement'],basis:UtiltsConditionDecision['basis'],product?:Extract<UtiltsProductResolution,{kind:'qualified'}>,parentSegmentIndex?:number,expected?:string) {
    // Published X cannot be relaxed by a catalogue or a dependent condition.
    if(row.requirement==='X') {requirement='forbidden';basis='published_matrix';product=undefined}
    const decision:UtiltsConditionDecision={...identity(scope),fieldNo:row.fieldNo,semanticKey:row.semanticKey,ruleKey:row.ruleKey,requirement,basis,sourceSha256:row.sourceSha256,...(product?{catalogueRows:product.rows.map(r=>r.row),catalogueSha256:UTILTS_TSP_SOURCE.sha256}:{}),...(parentSegmentIndex!==undefined?{parentSegmentIndex}:{})}
    result.decisions.push(decision)
    const occurrences=readUtiltsFieldOccurrences(row,scope,physical.una)
    const present=occurrences.filter(o=>o.value.trim())
    const kind=requirement==='forbidden'&&occurrences.length?'forbidden':requirement==='required'&&!present.length?'missing':expected&&present.some(o=>o.value!==expected)?'invalid':null
    if(!kind)return
    for(const occurrence of kind==='forbidden'?occurrences:[present[0]]) result.issues.push({...decision,kind,code:`UTILTS_FIELD_${row.fieldNo}_${kind.toUpperCase()}`,...(occurrence?{occurrence:{segmentIndex:occurrence.segmentIndex,elementIndex:occurrence.elementIndex,componentIndex:occurrence.componentIndex}}:{})})
  }
  for(const transaction of physical.transactions.filter(t=>t.messageCode===input.policy.code)) {
    const pia=bySemantic('time_series_product')
    const product:UtiltsProductResolution=pia&&pia.requirement!=='X'?parseUtiltsTimeSeriesProduct(transaction,physical.una):{kind:'not_applicable'}
    result.transactions.push({...identity(transaction),product})
    if(pia) {
      const finding=(fieldNo:string,kind:'missing'|'invalid')=>result.issues.push({...identity(transaction),fieldNo,semanticKey:pia.semanticKey,ruleKey:pia.ruleKey,requirement:'required' as const,basis:'swedish_detail' as const,sourceSha256:pia.sourceSha256,kind,code:`UTILTS_FIELD_${fieldNo}_${kind.toUpperCase()}`})
      if(product.kind==='absent') {
        if(pia.requirement==='R')finding('511','missing')
        else result.unresolved.push({...identity(transaction),fieldNo:'511',reason:'dependent_product_presence_unqualified'})
      }
      if(product.kind==='incomplete')for(const fieldNo of product.missingFields)finding(fieldNo,'missing')
      if(product.kind==='malformed')finding('511','invalid')
    }
    if(product.kind==='unqualified')result.holds.push({...identity(transaction),reason:'product_catalogue_unqualified'})
    const known=product.kind==='qualified'?product:undefined
    // Swedish U5 pp38/61 prohibit status for andelstal. Qualification here is
    // deliberately bounded to the independently identified current L359 row21;
    // other S01 products (or unknown tuples) need their own source mapping.
    const l359Andelstal = input.policy.code==='S01' && known?.rows.length===1
      && UTILTS_TSP_SOURCE.sha256==='53034f2fd3de416a84f755b454fc72378930126446909cee5eae968111db816b'
      && known.rows[0].row===21 && known.rows[0].productCode==='L359' && known.rows[0].valueField==='516'
      && known.tuple.every((value,index)=>value===['Z04','U46','Z02','Z58','Z05'][index])
    for(const row of rules.filter(r=>r.scope==='transaction')) {
      // This packet owns catalogue identity/unit conditions only. Unconditional
      // transaction fields remain with fieldMatrixProjection, avoiding duplicates.
      if(!mappedIdentityFields.has(row.fieldNo)&&row.fieldNo!=='264')continue
      if(known&&input.policy.code==='S01') {
        if(row.fieldNo==='264') {
          const kinds=new Set(known.rows.map(r=>r.valueField))
          const parents=transaction.observations.flatMap(o=>o.segments).filter(s=>['QTY','PRI','MOA'].includes(s.tag))
          const hasUnitMode=parents.some(s=>s.tag==='QTY'||s.tag==='PRI')
          const amountOnly=parents.length>0&&parents.every(s=>s.tag==='MOA')&&kinds.has('522')
          if(hasUnitMode||!kinds.has('522'))apply(row,transaction,'required','technical_catalogue',known)
          else if(amountOnly)apply(row,transaction,'forbidden','swedish_detail')
          else result.unresolved.push({...identity(transaction),fieldNo:row.fieldNo,reason:'mixed_product_value_mode_unqualified'})
        } else {
          const used=known.rows.some(r=>r.identityFields.includes(row.fieldNo))
          apply(row,transaction,used?'required':'forbidden','technical_catalogue',known)
        }
      } else if(row.requirement==='D')result.unresolved.push({...identity(transaction),fieldNo:row.fieldNo,ruleKey:row.ruleKey,reason:'object_or_product_condition_unqualified'})
    }
    for(const observation of transaction.observations) {
      for(const row of rules.filter(r=>r.scope==='observation')) {
        if(!hasUtiltsFieldReader(row))continue
        if(row.requirement==='X') {apply(row,observation,'forbidden','published_matrix');continue}
        if(l359Andelstal&&row.semanticKey==='quantity_quality') {apply(row,observation,'forbidden','swedish_detail',known);continue}
        if(row.semanticKey==='observation_id'||row.semanticKey==='planned_periodic_quantity') {
          if(row.requirement==='R')apply(row,observation,'required','published_matrix')
          continue
        }
        if(known&&['516','522','523'].includes(row.fieldNo)) {
          const used=known.rows.some(r=>r.valueField===row.fieldNo)
          const kinds=new Set(known.rows.map(r=>r.valueField))
          if(!used)apply(row,observation,'forbidden','technical_catalogue',known)
          else if(kinds.size===1||readUtiltsFieldOccurrences(row,observation,physical.una).length)apply(row,observation,'required','technical_catalogue',known)
          else result.unresolved.push({...identity(observation),fieldNo:row.fieldNo,reason:'mixed_product_value_mode_unqualified'})
          continue
        }
        if(row.requirement==='D'||row.condition)result.unresolved.push({...identity(observation),fieldNo:row.fieldNo,ruleKey:row.ruleKey,reason:row.fieldNo==='530a'&&['E30','S07'].includes(input.policy.code)?'source_conflict':'existing_semantic_owner'})
      }
      // Each value owns only its following child window. A sibling PRI/MOA/QTY
      // cannot provide a required currency, origin or reading date.
      for(let index=0;index<observation.segments.length;index++) {
        const parent=observation.segments[index]
        if(!['QTY','PRI','MOA'].includes(parent.tag))continue
        let end=index+1
        while(end<observation.segments.length&&!['QTY','PRI','MOA'].includes(observation.segments[end].tag))end++
        const window:UtiltsPhysicalScope={...observation,segments:observation.segments.slice(index,end)}
        const parentValue=segmentComposite(parent,1,physical.una)
        const required=(semantic:string,expected?:string)=>{const row=bySemantic(semantic);if(row&&row.requirement!=='X')apply(row,window,'required','swedish_detail',undefined,parent.index,expected)}
        if(parent.tag==='MOA'&&parentValue[0]==='9')required('monetary_currency')
        if(parent.tag==='PRI')required('price_currency')
        if(parent.tag==='QTY'&&parentValue[0]==='220'&&input.policy.code==='E66') {
          required('meter_reading_date')
          required('meter_reading_origin',parentValue[1]==='NULL'?'E27':undefined)
        }
      }
    }
  }
  if(!result.transactions.length)result.unresolved.push({reason:'physical_scope_unavailable'})
  // Source catalogue identity is retained separately: guide findings always cite
  // their Swedish guide hash, while derived decisions retain technical row basis.
  if(result.decisions.some(d=>d.basis==='technical_catalogue'))result.unresolved.push({reason:`remaining_conditions_not_qualified;catalogue=${UTILTS_TSP_SOURCE.sha256}`})
  return result
}
