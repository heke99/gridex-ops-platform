import {
  assessEscoReportingStart,
  assessPhysicalMethodCompletion,
  assessSupplierMethodNotice,
  type ObligationAssessment,
} from '@/lib/ediel/rulebook/reportingObligationPolicy'

/** Current private owner reads qualify a message watch, not a DSO's complete
 * receipt, the customer's approval, the required physical change or first
 * reporting. These facts are absent from the existing owner output. Do not
 * accept lookalike metadata, SMTP/ACK/local-apply times or historical periods
 * as substitutes. A future qualified receipt owner needs a separate adapter. */
export function reportingObligationContext(input:{
  sourceKind:'outbound_method_watch'|'outbound_esco_request'
  currentOwnerScopeValidated:boolean
  businessState:string
}):readonly ObligationAssessment[] {
  if(!input.currentOwnerScopeValidated||!['pending','fulfilled','rejected','manual_review'].includes(input.businessState))return Object.freeze([])
  if(input.sourceKind==='outbound_method_watch')return Object.freeze([
    assessSupplierMethodNotice({completeReceiptDay:null,changeRequired:null}),
    assessPhysicalMethodCompletion({completeReceiptDay:null,statedStartDay:null,changeRequired:null}),
  ])
  // This rejected request creates no new reporting-start assertion; it does
  // not revoke or assess any independently existing permission.
  if(input.sourceKind==='outbound_esco_request'&&input.businessState!=='rejected')return Object.freeze([
    assessEscoReportingStart({customerApprovalDay:null,confirmedStartDay:null,settlementChangeRequired:null}),
  ])
  return Object.freeze([])
}
