import {addCanonicalCalendarDays} from '@/lib/ediel/rulebook/deadlinePolicy'

export type ObligationKind = 'supplier_method_notice' | 'physical_method_completion' | 'esco_reporting_start'
export type ObligationAssessment = Readonly<{
  version:'ediel-handbook-26b-obligations/2026-10-20.v1'
  kind:ObligationKind
  status:'held'|'not_applicable'|'monitored_date'
  dueDay:string|null
  basis:'source_outer_date'|'conservative_internal_date'|null
  requiresImmediateAction:boolean
  sourceRefs:readonly string[]
  missing:readonly string[]
  legalBreachDetermined:false
  authorizesProviderEntry:false
  automaticResendAllowed:false
}>

const sources:Readonly<Record<ObligationKind,readonly string[]>>=Object.freeze({
  supplier_method_notice:Object.freeze(['EIFS-2025:1/11:11']),
  physical_method_completion:Object.freeze(['Elmarknadshandboken-26B/4.1.14']),
  esco_reporting_start:Object.freeze(['EIFS-2025:1/12:8','SFS-1930:173/1-2']),
})

function day(value:unknown):value is string {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false
  const instant=Date.parse(`${value}T00:00:00Z`)
  return Number.isFinite(instant)&&new Date(instant).toISOString().slice(0,10)===value
}

function addDays(value:string,count:number):string|null {
  try{const result=addCanonicalCalendarDays(value,count);return day(result)?result:null}catch{return null}
}

function assessment(kind:ObligationKind,status:ObligationAssessment['status'],missing:string[]=[],dueDay:string|null=null,
  basis:ObligationAssessment['basis']=null):ObligationAssessment {
  return Object.freeze({version:'ediel-handbook-26b-obligations/2026-10-20.v1',kind,status,dueDay,basis,
    requiresImmediateAction:status==='monitored_date'&&kind!=='esco_reporting_start',sourceRefs:sources[kind],
    missing:Object.freeze(missing),legalBreachDetermined:false,authorizesProviderEntry:false,automaticResendAllowed:false})
}

/** Semantic facts must already be qualified by their source owner. These pure
 * dates confer no authority and are never evidence of actual notification. */
export function assessSupplierMethodNotice(input:{completeReceiptDay:string|null;changeRequired:boolean|null}):ObligationAssessment {
  const kind='supplier_method_notice'
  if(input.changeRequired===false)return assessment(kind,'not_applicable')
  const missing=[...(input.changeRequired!==true?['method_change_applicability_required']:[]),
    ...(!day(input.completeReceiptDay)?['complete_request_receipt_day_required']:[])]
  if(missing.length)return assessment(kind,'held',missing)
  const due=addDays(input.completeReceiptDay!,40)
  return due?assessment(kind,'monitored_date',[],due,'source_outer_date'):assessment(kind,'held',['date_arithmetic_out_of_range'])
}

/** Physical completion has a later-stated-date branch. It is distinct from
 * both supplier notice and the handbook's validity+40 Z06F message table. */
export function assessPhysicalMethodCompletion(input:{completeReceiptDay:string|null;statedStartDay:string|null;changeRequired:boolean|null}):ObligationAssessment {
  const kind='physical_method_completion'
  if(input.changeRequired===false)return assessment(kind,'not_applicable')
  const missing=[...(input.changeRequired!==true?['method_change_applicability_required']:[]),
    ...(!day(input.completeReceiptDay)?['complete_request_receipt_day_required']:[]),
    ...(input.statedStartDay!==null&&!day(input.statedStartDay)?['stated_start_day_invalid']:[])]
  if(missing.length)return assessment(kind,'held',missing)
  const ordinary=addDays(input.completeReceiptDay!,40)
  if(!ordinary)return assessment(kind,'held',['date_arithmetic_out_of_range'])
  const due=input.statedStartDay&&input.statedStartDay>ordinary?input.statedStartDay:ordinary
  return assessment(kind,'monitored_date',[],due,'source_outer_date')
}

/** A calendar week preserves the weekday, including across DST. This is an
 * unextended internal monitoring date, not a legally exact instant/holiday
 * extension or proof of first UTILTS delivery. A later confirmed start is
 * monitored on that date, with no additional week. The method-change exception
 * needs its own qualified anchor rather than a borrowed notice/SMTP clock. */
export function assessEscoReportingStart(input:{customerApprovalDay:string|null;confirmedStartDay:string|null;settlementChangeRequired:boolean|null}):ObligationAssessment {
  const kind='esco_reporting_start'
  const missing=[...(!day(input.customerApprovalDay)?['customer_approval_day_required']:[]),
    ...(input.confirmedStartDay!==null&&!day(input.confirmedStartDay)?['confirmed_start_day_invalid']:[]),
    ...(input.settlementChangeRequired===null||typeof input.settlementChangeRequired!=='boolean'?['settlement_method_branch_required']:[]),
    ...(input.settlementChangeRequired===true?['qualified_settlement_exception_anchor_required']:[])]
  if(missing.length)return assessment(kind,'held',missing)
  const ordinary=addDays(input.customerApprovalDay!,7)
  if(!ordinary)return assessment(kind,'held',['date_arithmetic_out_of_range'])
  const due=input.confirmedStartDay&&input.confirmedStartDay>input.customerApprovalDay!?input.confirmedStartDay:ordinary
  return assessment(kind,'monitored_date',[],due,'conservative_internal_date')
}
