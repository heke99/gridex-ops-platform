import { resolveCanonicalAckMatrixRule } from '@/lib/ediel/ack/canonicalAckEngine'
import { PRODAT_CANONICAL_PROFILES } from '@/lib/ediel/rulebook/prodatRulebook'
import {
  PRODAT_SUBTYPE_RULES,
  canonicalProdatSubtypeAlias,
  type ProdatMessageCode,
  type ProdatSubtype,
} from '@/lib/ediel/rulebook/prodatSubtypeRegistry'
import {
  getCanonicalSupplierUtiltsSupport,
  type SupplierUtiltsSupport,
} from '@/lib/ediel/rulebook/utiltsMarketSemantics'
import {
  UTILTS_CANONICAL_PROFILES,
  type UtiltsCanonicalMessageCode,
} from '@/lib/ediel/rulebook/utiltsRulebook'

export type CanonicalEdielBusinessFamily = 'PRODAT' | 'UTILTS' | 'CONTRL' | 'APERAK' | 'UTILTS_ERR'
export type CanonicalEdielDirection = 'inbound' | 'outbound' | 'both'
export type CanonicalEdielOperationKind =
  | 'request'
  | 'response'
  | 'notification'
  | 'cancellation'
  | 'reversal'
  | 'termination_request'
  | 'termination_notice'
  | 'data'
  | 'technical_ack'
  | 'application_ack'
  | 'functional_error'
  | 'manual_bilateral_process'

export type CanonicalEdielDomainObject =
  | 'grid_contract_check'
  | 'supply_relationship'
  | 'customer_masterdata'
  | 'metering_point_masterdata'
  | 'meter_masterdata'
  | 'balance_responsibility'
  | 'production_purchase_obligation'
  | 'high_resolution_metering_agreement'
  | 'metering_data_permission'
  | 'historical_metering_data_permission'
  | 'validated_metering_values'
  | 'collected_metering_values'
  | 'object_consumption_forecast'
  | 'object_time_series'
  | 'aggregate_metering_values'
  | 'aggregate_settlement_values'
  | 'preliminary_settlement_values'
  | 'interchange'
  | 'application_transaction'
  | 'utilts_transaction'

export type CanonicalEdielBusinessEffect =
  | 'none'
  | 'request_grid_contract_check'
  | 'record_grid_contract_response'
  | 'request_supplier_switch'
  | 'request_customer_and_supplier_change'
  | 'cancel_pending_supplier_change'
  | 'confirm_supplier_change'
  | 'confirm_customer_and_supplier_change'
  | 'confirm_change_cancellation'
  | 'start_assigned_supply'
  | 'start_production_receipt_obligation'
  | 'end_existing_supply'
  | 'continue_existing_supply'
  | 'request_supply_end'
  | 'update_customer_masterdata'
  | 'update_metering_point_with_reading'
  | 'update_metering_point_masterdata'
  | 'update_meter_masterdata'
  | 'change_balance_responsible'
  | 'change_production_purchase_agreement'
  | 'request_high_resolution_values'
  | 'end_high_resolution_values_agreement'
  | 'request_metering_reporting'
  | 'request_historical_metering_data'
  | 'approve_metering_reporting'
  | 'approve_historical_metering_data'
  | 'reject_metering_reporting'
  | 'stop_metering_reporting'
  | 'stop_historical_metering_reporting'
  | 'continue_metering_reporting'
  | 'request_stop_metering_reporting'
  | 'deliver_values'
  | 'request_missing_values'
  | 'technical_acknowledgement'
  | 'application_acknowledgement'
  | 'functional_rejection'
  | 'manual_review_only'

export type CanonicalEdielDataScope =
  | 'metering_point'
  | 'metering_point_or_regulating_object'
  | 'grid_area'
  | 'grid_area_or_regulating_object'
  | 'transaction'
  | 'interchange'
  | 'error_context'

export type CanonicalEdielBilateralPolicy = 'none' | 'always' | 'contextual'

export type CanonicalEdielBusinessSemantics = {
  family: CanonicalEdielBusinessFamily
  code: string
  subtype: string | null
  transactionReasonCode: string | null
  officialMeaning: string
  businessProcess: string
  operationKind: CanonicalEdielOperationKind
  domainObject: CanonicalEdielDomainObject
  businessEffect: CanonicalEdielBusinessEffect
  direction: CanonicalEdielDirection
  senderRoles: readonly string[]
  receiverRoles: readonly string[]
  expectedBusinessResponses: readonly string[]
  expectedAcknowledgements: readonly string[]
  dataScope: CanonicalEdielDataScope
  historical: boolean
  carriesQuantities: boolean
  requestsData: boolean
  bilateralPolicy: CanonicalEdielBilateralPolicy
  requiresCustomerStatus: boolean
  autoStateMutationAllowed: boolean
  supplierUtiltsSupport: SupplierUtiltsSupport | null
  source: {
    document: string
    version: string
    revision: string
    effectiveFrom: string
    pageOrSection: string
  }
}

type ProdatDefinition = Pick<
  CanonicalEdielBusinessSemantics,
  | 'officialMeaning'
  | 'businessProcess'
  | 'operationKind'
  | 'domainObject'
  | 'businessEffect'
  | 'expectedBusinessResponses'
  | 'historical'
  | 'requestsData'
  | 'bilateralPolicy'
  | 'requiresCustomerStatus'
  | 'autoStateMutationAllowed'
>

const none: readonly string[] = []

/**
 * Business meanings from Svensk Elmarknadshandbok 26A chapter 10/11 and
 * PRODAT 26.A field 223. This table describes effects, not EDIFACT field
 * cardinality; field rules remain in the canonical field matrix.
 *
 * Important distinctions:
 * - Z13/Z14/Z15/Z18 govern permission/reporting, not the actual quantities.
 * - E66/S02/etc carry values; E72/E73/E74/S06 request missing values.
 * - cancellation/reversal is not the same thing as termination.
 */
const PRODAT_DEFINITIONS: Record<string, ProdatDefinition> = {
  'Z01:L':  { officialMeaning: 'Inquiry whether the customer has a valid grid agreement for a supplier switch.', businessProcess: 'grid_contract_check_supplier_switch', operationKind: 'request', domainObject: 'grid_contract_check', businessEffect: 'request_grid_contract_check', expectedBusinessResponses: ['PRODAT:Z02:L'], historical: false, requestsData: false, bilateralPolicy: 'none', requiresCustomerStatus: false, autoStateMutationAllowed: false },
  'Z01:LK': { officialMeaning: 'Inquiry whether the customer has a valid grid agreement for a customer-and-supplier change / move-in process.', businessProcess: 'grid_contract_check_customer_supplier_change', operationKind: 'request', domainObject: 'grid_contract_check', businessEffect: 'request_grid_contract_check', expectedBusinessResponses: ['PRODAT:Z02:LK'], historical: false, requestsData: false, bilateralPolicy: 'none', requiresCustomerStatus: false, autoStateMutationAllowed: false },
  'Z02:L':  { officialMeaning: 'Grid-owner response to Z01L concerning valid grid agreement for supplier switch.', businessProcess: 'grid_contract_check_response_supplier_switch', operationKind: 'response', domainObject: 'grid_contract_check', businessEffect: 'record_grid_contract_response', expectedBusinessResponses: none, historical: false, requestsData: false, bilateralPolicy: 'none', requiresCustomerStatus: false, autoStateMutationAllowed: true },
  'Z02:LK': { officialMeaning: 'Grid-owner response to Z01LK concerning valid grid agreement for customer-and-supplier change.', businessProcess: 'grid_contract_check_response_customer_supplier_change', operationKind: 'response', domainObject: 'grid_contract_check', businessEffect: 'record_grid_contract_response', expectedBusinessResponses: none, historical: false, requestsData: false, bilateralPolicy: 'none', requiresCustomerStatus: false, autoStateMutationAllowed: true },

  'Z03:L':  { officialMeaning: 'Notification of supplier switch from the new supplier to the grid owner.', businessProcess: 'supplier_switch', operationKind: 'request', domainObject: 'supply_relationship', businessEffect: 'request_supplier_switch', expectedBusinessResponses: ['PRODAT:Z04:L'], historical: false, requestsData: false, bilateralPolicy: 'none', requiresCustomerStatus: false, autoStateMutationAllowed: false },
  'Z03:LK': { officialMeaning: 'Notification of change of customer and supplier; move-in is one valid use but not the only meaning.', businessProcess: 'customer_and_supplier_change', operationKind: 'request', domainObject: 'supply_relationship', businessEffect: 'request_customer_and_supplier_change', expectedBusinessResponses: ['PRODAT:Z04:LK'], historical: false, requestsData: false, bilateralPolicy: 'none', requiresCustomerStatus: false, autoStateMutationAllowed: false },
  'Z03:C':  { officialMeaning: 'Withdrawal/cancellation of a previously notified supplier/customer change before it takes effect.', businessProcess: 'supplier_change_cancellation', operationKind: 'cancellation', domainObject: 'supply_relationship', businessEffect: 'cancel_pending_supplier_change', expectedBusinessResponses: ['PRODAT:Z04:C'], historical: false, requestsData: false, bilateralPolicy: 'none', requiresCustomerStatus: false, autoStateMutationAllowed: true },
  'Z03:H':  { officialMeaning: 'Bilateral Z03 change-procedure message using unspecified reason Z25; not a standard rescission flow.', businessProcess: 'bilateral_unspecified_change', operationKind: 'manual_bilateral_process', domainObject: 'supply_relationship', businessEffect: 'manual_review_only', expectedBusinessResponses: ['PRODAT:Z04:H'], historical: false, requestsData: false, bilateralPolicy: 'always', requiresCustomerStatus: false, autoStateMutationAllowed: false },

  'Z04:L':  { officialMeaning: 'Grid-owner confirmation/response to a supplier-switch notification Z03L.', businessProcess: 'supplier_switch_confirmation', operationKind: 'response', domainObject: 'supply_relationship', businessEffect: 'confirm_supplier_change', expectedBusinessResponses: none, historical: false, requestsData: false, bilateralPolicy: 'none', requiresCustomerStatus: false, autoStateMutationAllowed: true },
  'Z04:LK': { officialMeaning: 'Grid-owner confirmation/response to a customer-and-supplier change Z03LK.', businessProcess: 'customer_and_supplier_change_confirmation', operationKind: 'response', domainObject: 'supply_relationship', businessEffect: 'confirm_customer_and_supplier_change', expectedBusinessResponses: none, historical: false, requestsData: false, bilateralPolicy: 'none', requiresCustomerStatus: false, autoStateMutationAllowed: true },
  'Z04:C':  { officialMeaning: 'Grid-owner confirmation that the previously notified supplier change has been withdrawn.', businessProcess: 'supplier_change_cancellation_confirmation', operationKind: 'response', domainObject: 'supply_relationship', businessEffect: 'confirm_change_cancellation', expectedBusinessResponses: none, historical: false, requestsData: false, bilateralPolicy: 'none', requiresCustomerStatus: false, autoStateMutationAllowed: true },
  'Z04:H':  { officialMeaning: 'Bilateral grid-owner response/information for an unspecified Z25 change-procedure reason.', businessProcess: 'bilateral_unspecified_change_response', operationKind: 'manual_bilateral_process', domainObject: 'supply_relationship', businessEffect: 'manual_review_only', expectedBusinessResponses: none, historical: false, requestsData: false, bilateralPolicy: 'always', requiresCustomerStatus: false, autoStateMutationAllowed: false },
  'Z04:A':  { officialMeaning: 'Information from the grid owner that assigned/default supply starts.', businessProcess: 'assigned_supply_start', operationKind: 'notification', domainObject: 'supply_relationship', businessEffect: 'start_assigned_supply', expectedBusinessResponses: none, historical: false, requestsData: false, bilateralPolicy: 'always', requiresCustomerStatus: false, autoStateMutationAllowed: false },
  'Z04:D':  { officialMeaning: 'Information that the obligation to receive production becomes effective.', businessProcess: 'production_receipt_obligation_start', operationKind: 'notification', domainObject: 'production_purchase_obligation', businessEffect: 'start_production_receipt_obligation', expectedBusinessResponses: none, historical: false, requestsData: false, bilateralPolicy: 'none', requiresCustomerStatus: false, autoStateMutationAllowed: true },

  'Z05:L':  { officialMeaning: 'Information to the current/old supplier that supply ends, normally due to supplier switch; also the business response to Z08H.', businessProcess: 'existing_supply_end_supplier_change', operationKind: 'termination_notice', domainObject: 'supply_relationship', businessEffect: 'end_existing_supply', expectedBusinessResponses: none, historical: false, requestsData: false, bilateralPolicy: 'none', requiresCustomerStatus: false, autoStateMutationAllowed: true },
  'Z05:LK': { officialMeaning: 'Information to the current supplier that supply ends because the grid agreement/customer relationship ends.', businessProcess: 'existing_supply_end_customer_change', operationKind: 'termination_notice', domainObject: 'supply_relationship', businessEffect: 'end_existing_supply', expectedBusinessResponses: none, historical: false, requestsData: false, bilateralPolicy: 'none', requiresCustomerStatus: false, autoStateMutationAllowed: true },
  'Z05:C':  { officialMeaning: 'Information to the previous supplier that supply continues because an earlier ending/change was cancelled.', businessProcess: 'existing_supply_continues_after_cancellation', operationKind: 'reversal', domainObject: 'supply_relationship', businessEffect: 'continue_existing_supply', expectedBusinessResponses: none, historical: false, requestsData: false, bilateralPolicy: 'none', requiresCustomerStatus: false, autoStateMutationAllowed: true },
  'Z05:H':  { officialMeaning: 'Bilateral information to the old supplier using unspecified reason Z25.', businessProcess: 'bilateral_unspecified_supply_change_notice', operationKind: 'manual_bilateral_process', domainObject: 'supply_relationship', businessEffect: 'manual_review_only', expectedBusinessResponses: none, historical: false, requestsData: false, bilateralPolicy: 'always', requiresCustomerStatus: false, autoStateMutationAllowed: false },

  'Z06:E':  { officialMeaning: 'Grid-owner customer masterdata update, normally death/bankruptcy; other purposes require counterparty-specific bilateral agreement.', businessProcess: 'customer_masterdata_update_grid_to_supplier', operationKind: 'notification', domainObject: 'customer_masterdata', businessEffect: 'update_customer_masterdata', expectedBusinessResponses: none, historical: false, requestsData: false, bilateralPolicy: 'contextual', requiresCustomerStatus: true, autoStateMutationAllowed: false },
  'Z06:F':  { officialMeaning: 'Grid-owner metering-point/meter information update requiring a meter reading; may also signal connect/disconnect or metering-method change.', businessProcess: 'metering_point_update_with_reading', operationKind: 'notification', domainObject: 'metering_point_masterdata', businessEffect: 'update_metering_point_with_reading', expectedBusinessResponses: none, historical: false, requestsData: false, bilateralPolicy: 'none', requiresCustomerStatus: false, autoStateMutationAllowed: false },
  'Z06:G':  { officialMeaning: 'Grid-owner metering-point masterdata update that does not itself require a meter reading.', businessProcess: 'metering_point_masterdata_update', operationKind: 'notification', domainObject: 'metering_point_masterdata', businessEffect: 'update_metering_point_masterdata', expectedBusinessResponses: none, historical: false, requestsData: false, bilateralPolicy: 'none', requiresCustomerStatus: false, autoStateMutationAllowed: false },

  'Z08:H':  { officialMeaning: 'Supplier notification of rescission/termination (hävning) to the grid owner.', businessProcess: 'supplier_rescission', operationKind: 'termination_request', domainObject: 'supply_relationship', businessEffect: 'request_supply_end', expectedBusinessResponses: ['PRODAT:Z05:L'], historical: false, requestsData: false, bilateralPolicy: 'none', requiresCustomerStatus: false, autoStateMutationAllowed: false },
  'Z08:LK': { officialMeaning: 'Bilateral Z08 use with change-of-customer-and-supplier reason Z23.', businessProcess: 'bilateral_customer_supplier_change_notice', operationKind: 'manual_bilateral_process', domainObject: 'supply_relationship', businessEffect: 'manual_review_only', expectedBusinessResponses: none, historical: false, requestsData: false, bilateralPolicy: 'always', requiresCustomerStatus: false, autoStateMutationAllowed: false },

  'Z09:B':  { officialMeaning: 'Supplier notification to the grid owner of change of balance responsible party.', businessProcess: 'balance_responsible_change', operationKind: 'notification', domainObject: 'balance_responsibility', businessEffect: 'change_balance_responsible', expectedBusinessResponses: none, historical: false, requestsData: false, bilateralPolicy: 'none', requiresCustomerStatus: false, autoStateMutationAllowed: false },
  'Z09:D':  { officialMeaning: 'Supplier information that a production purchase agreement starts or ends, affecting the obligation to receive production.', businessProcess: 'production_purchase_agreement_change', operationKind: 'notification', domainObject: 'production_purchase_obligation', businessEffect: 'change_production_purchase_agreement', expectedBusinessResponses: none, historical: false, requestsData: false, bilateralPolicy: 'none', requiresCustomerStatus: false, autoStateMutationAllowed: false },
  'Z09:E':  { officialMeaning: 'Supplier customer-masterdata notification, normally death/bankruptcy; other purposes require counterparty-specific bilateral agreement.', businessProcess: 'customer_masterdata_update_supplier_to_grid', operationKind: 'notification', domainObject: 'customer_masterdata', businessEffect: 'update_customer_masterdata', expectedBusinessResponses: ['PRODAT:Z06:E'], historical: false, requestsData: false, bilateralPolicy: 'contextual', requiresCustomerStatus: true, autoStateMutationAllowed: false },
  'Z09:F':  { officialMeaning: 'Supplier informs the grid owner that the supplier/customer agreement requires high-resolution (15-minute) values; this is not itself a physical meter change.', businessProcess: 'high_resolution_values_agreement_start', operationKind: 'notification', domainObject: 'high_resolution_metering_agreement', businessEffect: 'request_high_resolution_values', expectedBusinessResponses: none, historical: false, requestsData: false, bilateralPolicy: 'none', requiresCustomerStatus: false, autoStateMutationAllowed: false },
  'Z09:G':  { officialMeaning: 'Supplier informs the grid owner that the agreement requiring high-resolution values has ended.', businessProcess: 'high_resolution_values_agreement_end', operationKind: 'termination_notice', domainObject: 'high_resolution_metering_agreement', businessEffect: 'end_high_resolution_values_agreement', expectedBusinessResponses: none, historical: false, requestsData: false, bilateralPolicy: 'none', requiresCustomerStatus: false, autoStateMutationAllowed: false },

  'Z10:M':  { officialMeaning: 'Grid-owner meter replacement/masterdata update where the meter identity changes.', businessProcess: 'meter_replacement', operationKind: 'notification', domainObject: 'meter_masterdata', businessEffect: 'update_meter_masterdata', expectedBusinessResponses: none, historical: false, requestsData: false, bilateralPolicy: 'none', requiresCustomerStatus: false, autoStateMutationAllowed: false },

  'Z13:V':  { officialMeaning: 'Eligible party/ESCO request to start ongoing metering-data reporting/data sharing.', businessProcess: 'metering_reporting_permission_request', operationKind: 'request', domainObject: 'metering_data_permission', businessEffect: 'request_metering_reporting', expectedBusinessResponses: ['PRODAT:Z14:V', 'PRODAT:Z14:N'], historical: false, requestsData: true, bilateralPolicy: 'none', requiresCustomerStatus: false, autoStateMutationAllowed: false },
  'Z13:VH': { officialMeaning: 'Eligible party/ESCO request for historical metering data.', businessProcess: 'historical_metering_data_request', operationKind: 'request', domainObject: 'historical_metering_data_permission', businessEffect: 'request_historical_metering_data', expectedBusinessResponses: ['PRODAT:Z14:VH', 'PRODAT:Z14:N'], historical: true, requestsData: true, bilateralPolicy: 'none', requiresCustomerStatus: false, autoStateMutationAllowed: false },
  'Z14:V':  { officialMeaning: 'Grid-owner approval/response to Z13V; reporting starts from the confirmed start date.', businessProcess: 'metering_reporting_permission_response', operationKind: 'response', domainObject: 'metering_data_permission', businessEffect: 'approve_metering_reporting', expectedBusinessResponses: none, historical: false, requestsData: false, bilateralPolicy: 'none', requiresCustomerStatus: false, autoStateMutationAllowed: true },
  'Z14:VH': { officialMeaning: 'Grid-owner approval/response to request for historical metering data.', businessProcess: 'historical_metering_data_response', operationKind: 'response', domainObject: 'historical_metering_data_permission', businessEffect: 'approve_historical_metering_data', expectedBusinessResponses: none, historical: true, requestsData: false, bilateralPolicy: 'none', requiresCustomerStatus: false, autoStateMutationAllowed: true },
  'Z14:N':  { officialMeaning: 'Grid-owner rejection: none of the requested metering-data permissions were approved.', businessProcess: 'metering_reporting_permission_rejection', operationKind: 'response', domainObject: 'metering_data_permission', businessEffect: 'reject_metering_reporting', expectedBusinessResponses: none, historical: false, requestsData: false, bilateralPolicy: 'none', requiresCustomerStatus: false, autoStateMutationAllowed: true },
  'Z15:V':  { officialMeaning: 'Grid-owner notice that ongoing metering-data reporting has stopped.', businessProcess: 'metering_reporting_ended', operationKind: 'termination_notice', domainObject: 'metering_data_permission', businessEffect: 'stop_metering_reporting', expectedBusinessResponses: none, historical: false, requestsData: false, bilateralPolicy: 'none', requiresCustomerStatus: false, autoStateMutationAllowed: true },
  'Z15:VH': { officialMeaning: 'Grid-owner notice that historical metering-data reporting has ended.', businessProcess: 'historical_metering_reporting_ended', operationKind: 'termination_notice', domainObject: 'historical_metering_data_permission', businessEffect: 'stop_historical_metering_reporting', expectedBusinessResponses: none, historical: true, requestsData: false, bilateralPolicy: 'none', requiresCustomerStatus: false, autoStateMutationAllowed: true },
  'Z15:C':  { officialMeaning: 'Cancellation/reversal of an earlier reporting-end notice: metering-data reporting continues.', businessProcess: 'metering_reporting_end_reversed', operationKind: 'reversal', domainObject: 'metering_data_permission', businessEffect: 'continue_metering_reporting', expectedBusinessResponses: none, historical: false, requestsData: false, bilateralPolicy: 'none', requiresCustomerStatus: false, autoStateMutationAllowed: true },
  'Z18:V':  { officialMeaning: 'Eligible party/ESCO request/information that ongoing metering-data reporting should stop.', businessProcess: 'metering_reporting_end_request', operationKind: 'termination_request', domainObject: 'metering_data_permission', businessEffect: 'request_stop_metering_reporting', expectedBusinessResponses: ['PRODAT:Z15:V'], historical: false, requestsData: false, bilateralPolicy: 'none', requiresCustomerStatus: false, autoStateMutationAllowed: false },
}

function expectedAcknowledgements(family: CanonicalEdielBusinessFamily, code: string): readonly string[] {
  const ack = resolveCanonicalAckMatrixRule({ family, code })
  const expected: string[] = []
  if (ack.technicalAck === 'CONTRL') expected.push('CONTRL')
  if (ack.applicationAck === 'APERAK' || ack.applicationAck === 'transactional') expected.push('APERAK')
  return expected
}

function prodatDirection(direction: 'actor_to_portal' | 'portal_to_actor'): CanonicalEdielDirection {
  return direction === 'actor_to_portal' ? 'outbound' : 'inbound'
}

function buildProdatSemantics(): CanonicalEdielBusinessSemantics[] {
  const result: CanonicalEdielBusinessSemantics[] = []
  for (const profile of PRODAT_CANONICAL_PROFILES) {
    for (const subtypeRule of profile.subtypeRules) {
      const key = `${profile.messageCode}:${subtypeRule.subtype}`
      const definition = PRODAT_DEFINITIONS[key]
      if (!definition) throw new Error(`canonical_prodat_business_semantics_missing:${key}`)
      result.push({
        family: 'PRODAT',
        code: profile.messageCode,
        subtype: subtypeRule.subtype,
        transactionReasonCode: subtypeRule.transactionReasonCode,
        ...definition,
        direction: prodatDirection(profile.direction),
        senderRoles: [profile.senderRole],
        receiverRoles: [profile.receiverRole],
        expectedAcknowledgements: expectedAcknowledgements('PRODAT', profile.messageCode),
        dataScope: 'metering_point',
        carriesQuantities: false,
        supplierUtiltsSupport: null,
        source: {
          document: '260630_Ediel_PRODAT_APERAK_Anvisning_version_26-A_16-B + Svensk Elmarknadshandbok 26A',
          version: profile.guideVersion,
          revision: profile.guideRevision,
          effectiveFrom: profile.effectiveFrom,
          pageOrSection: 'PRODAT field 223 and Handbook chapters 4, 10, 11',
        },
      })
    }
  }
  return result
}

function utiltsDirection(code: UtiltsCanonicalMessageCode): CanonicalEdielDirection {
  const support = getCanonicalSupplierUtiltsSupport(code)
  if (support === 'inbound_only') return 'inbound'
  if (support === 'outbound_only') return 'outbound'
  // Manual-review and non-supplier messages have no automatic Gridex supplier
  // direction. Keep both only as a compatibility shape; supplierUtiltsSupport
  // is the authoritative gate and autoStateMutationAllowed remains false.
  return 'both'
}

function utiltsDomainObject(code: UtiltsCanonicalMessageCode): CanonicalEdielDomainObject {
  if (code === 'S02') return 'object_consumption_forecast'
  if (code === 'S07') return 'object_time_series'
  if (code === 'E30') return 'collected_metering_values'
  if (code === 'E66') return 'validated_metering_values'
  if (['E31', 'E74'].includes(code)) return 'aggregate_metering_values'
  if (['S03', 'S04'].includes(code)) return 'preliminary_settlement_values'
  if (['S01', 'S05', 'S06'].includes(code)) return 'aggregate_settlement_values'
  if (code === 'E72') return 'collected_metering_values'
  if (code === 'E73') return 'validated_metering_values'
  return 'utilts_transaction'
}

function utiltsResponses(code: UtiltsCanonicalMessageCode): readonly string[] {
  if (code === 'E72') return ['UTILTS:E30']
  if (code === 'E73') return ['UTILTS:E66', 'UTILTS:S02']
  if (code === 'E74') return ['UTILTS:E31', 'UTILTS:S03']
  if (code === 'S06') return ['UTILTS:S01', 'UTILTS:S04']
  return none
}

function utiltsDataScope(identity: string): CanonicalEdielDataScope {
  if (identity === 'metering_point') return 'metering_point'
  if (identity === 'metering_point_or_regulating_object') return 'metering_point_or_regulating_object'
  if (identity === 'aggregate') return 'grid_area'
  if (identity === 'aggregate_or_regulating_object') return 'grid_area_or_regulating_object'
  return 'error_context'
}

function buildUtiltsSemantics(): CanonicalEdielBusinessSemantics[] {
  return UTILTS_CANONICAL_PROFILES.map((profile) => {
    const request = profile.scope === 'request'
    const error = profile.messageCode === 'ERR'
    const family: CanonicalEdielBusinessFamily = error ? 'UTILTS_ERR' : 'UTILTS'
    const supplierSupport = getCanonicalSupplierUtiltsSupport(profile.messageCode)
    return {
      family,
      code: profile.messageCode,
      subtype: null,
      transactionReasonCode: null,
      officialMeaning: profile.officialMeaning,
      businessProcess: profile.businessProcess,
      operationKind: error ? 'functional_error' : request ? 'request' : 'data',
      domainObject: utiltsDomainObject(profile.messageCode),
      businessEffect: error ? 'functional_rejection' : request ? 'request_missing_values' : 'deliver_values',
      direction: utiltsDirection(profile.messageCode),
      senderRoles: profile.allowedSenderRoles,
      receiverRoles: profile.allowedReceiverRoles,
      expectedBusinessResponses: utiltsResponses(profile.messageCode),
      expectedAcknowledgements: expectedAcknowledgements(family, profile.messageCode),
      dataScope: utiltsDataScope(profile.identityRequirement),
      historical: false,
      carriesQuantities: profile.requiresQuantities,
      requestsData: request,
      bilateralPolicy: profile.bilateralCapabilityRequired ? 'always' : 'none',
      requiresCustomerStatus: false,
      autoStateMutationAllowed: !request && !error && supplierSupport === 'inbound_only' && profile.productionReadiness !== 'partial',
      supplierUtiltsSupport: supplierSupport,
      source: {
        document: profile.guideDocumentName,
        version: profile.guideVersion,
        revision: profile.guideRevision,
        effectiveFrom: profile.effectiveFrom,
        pageOrSection: 'UTILTS canonical message profile / field matrix',
      },
    } satisfies CanonicalEdielBusinessSemantics
  })
}

const ACK_SEMANTICS: readonly CanonicalEdielBusinessSemantics[] = [
  {
    family: 'CONTRL', code: 'CONTRL', subtype: null, transactionReasonCode: null,
    officialMeaning: 'Technical EDIFACT interchange/message acknowledgement.', businessProcess: 'technical_ack', operationKind: 'technical_ack', domainObject: 'interchange', businessEffect: 'technical_acknowledgement', direction: 'both', senderRoles: [], receiverRoles: [], expectedBusinessResponses: none, expectedAcknowledgements: expectedAcknowledgements('CONTRL', 'CONTRL'), dataScope: 'interchange', historical: false, carriesQuantities: false, requestsData: false, bilateralPolicy: 'none', requiresCustomerStatus: false, autoStateMutationAllowed: true, supplierUtiltsSupport: null,
    source: { document: 'Ediel General Technical Rules', version: '24-A-6', revision: '6', effectiveFrom: '2024-01-01', pageOrSection: 'CONTRL acknowledgement rules' },
  },
  {
    family: 'APERAK', code: 'APERAK', subtype: null, transactionReasonCode: null,
    officialMeaning: 'Application acknowledgement or application-level rejection of a referenced business message.', businessProcess: 'application_ack', operationKind: 'application_ack', domainObject: 'application_transaction', businessEffect: 'application_acknowledgement', direction: 'both', senderRoles: [], receiverRoles: [], expectedBusinessResponses: none, expectedAcknowledgements: expectedAcknowledgements('APERAK', 'APERAK'), dataScope: 'transaction', historical: false, carriesQuantities: false, requestsData: false, bilateralPolicy: 'none', requiresCustomerStatus: false, autoStateMutationAllowed: true, supplierUtiltsSupport: null,
    source: { document: 'PRODAT/APERAK 26.A/16.B and UTILTS/APERAK guides', version: 'context-dependent', revision: 'context-dependent', effectiveFrom: '2016-12-01', pageOrSection: 'APERAK acknowledgement rules' },
  },
] as const

export const CANONICAL_EDIEL_BUSINESS_SEMANTICS: readonly CanonicalEdielBusinessSemantics[] = [
  ...buildProdatSemantics(),
  ...buildUtiltsSemantics(),
  ...ACK_SEMANTICS,
]

export function listCanonicalEdielBusinessSemantics(): readonly CanonicalEdielBusinessSemantics[] {
  return CANONICAL_EDIEL_BUSINESS_SEMANTICS
}

export function resolveCanonicalEdielBusinessSemantics(input: {
  family: string | null | undefined
  code: string | null | undefined
  subtype?: string | null
}): CanonicalEdielBusinessSemantics | null {
  const family = String(input.family ?? '').trim().toUpperCase()
  const code = String(input.code ?? '').trim().toUpperCase()
  const subtype = family === 'PRODAT'
    ? canonicalProdatSubtypeAlias(input.subtype, code)
    : String(input.subtype ?? '').trim().toUpperCase() || null

  const exact = CANONICAL_EDIEL_BUSINESS_SEMANTICS.find((entry) =>
    entry.family === family && entry.code === code && entry.subtype === subtype
  )
  if (exact) return exact

  return CANONICAL_EDIEL_BUSINESS_SEMANTICS.find((entry) =>
    entry.family === family && entry.code === code && entry.subtype === null
  ) ?? null
}

export function assertCanonicalEdielBusinessSemanticCoverage(): void {
  for (const rule of PRODAT_SUBTYPE_RULES) {
    for (const code of rule.allowedMessageCodes) {
      if (!PRODAT_DEFINITIONS[`${code}:${rule.subtype}`]) {
        throw new Error(`canonical_prodat_business_semantics_missing:${code}:${rule.subtype}`)
      }
    }
  }

  for (const profile of UTILTS_CANONICAL_PROFILES) {
    const family = profile.messageCode === 'ERR' ? 'UTILTS_ERR' : 'UTILTS'
    if (!resolveCanonicalEdielBusinessSemantics({ family, code: profile.messageCode })) {
      throw new Error(`canonical_utilts_business_semantics_missing:${profile.messageCode}`)
    }
  }
}

export function canonicalProdatBusinessMeaning(code: ProdatMessageCode, subtype: ProdatSubtype): string {
  return PRODAT_DEFINITIONS[`${code}:${subtype}`]?.officialMeaning ?? ''
}
