import type { RulebookFieldRule } from '@/lib/ediel/rulebook/fieldMatrix'

export const PRODAT_26A_MESSAGE_CODES = ['Z01','Z02','Z03','Z04','Z05','Z06','Z08','Z09','Z10','Z13','Z14','Z15','Z18'] as const
export type Prodat26AMessageCode = (typeof PRODAT_26A_MESSAGE_CODES)[number]
export type Prodat26ARequirement = 'R' | 'D' | 'O' | '-'

type MatrixRow = {
  fieldNumber: string
  fieldKey: string
  segmentPath: string
  requirements: readonly Prodat26ARequirement[]
}

/**
 * Immutable PRODAT 26.A field matrix.
 *
 * Source: Svenska kraftnät, 260630_Ediel_PRODAT_APERAK_Anvisning_version_26-A_16-B,
 * revision 3, effective 2026-04-01. The ordering of requirements is exactly
 * PRODAT_26A_MESSAGE_CODES. Database field-rule rows are projections/evidence;
 * they are not allowed to redefine these normative requirements at runtime.
 */
export const PRODAT_26A_FIELD_MATRIX: readonly MatrixRow[] = [
  {fieldNumber:'311',fieldKey:'application_reference',segmentPath:'UNB/S005/0026',requirements:['R','R','R','R','R','R','R','R','R','R','R','R','R']},
  {fieldNumber:'312',fieldKey:'association_assigned_code',segmentPath:'UNH/S009/0057',requirements:['R','R','R','R','R','R','R','R','R','R','R','R','R']},
  {fieldNumber:'202',fieldKey:'message_code',segmentPath:'BGM/C002/1001',requirements:['R','R','R','R','R','R','R','R','R','R','R','R','R']},
  {fieldNumber:'203',fieldKey:'message_id',segmentPath:'UNH/0062',requirements:['R','R','R','R','R','R','R','R','R','R','R','R','R']},
  {fieldNumber:'204',fieldKey:'message_function',segmentPath:'BGM/1225',requirements:['O','O','O','O','O','O','O','O','O','O','O','O','O']},
  {fieldNumber:'313',fieldKey:'request_for_acknowledgement',segmentPath:'BGM/4343',requirements:['O','R','R','R','R','R','R','R','R','R','R','R','R']},
  {fieldNumber:'205',fieldKey:'document_date',segmentPath:'DTM+137',requirements:['R','R','R','R','R','R','R','R','R','R','R','R','R']},
  {fieldNumber:'206',fieldKey:'timezone',segmentPath:'DTM+ZZZ',requirements:['R','R','R','R','R','R','R','R','R','R','R','R','R']},
  {fieldNumber:'301',fieldKey:'free_text_header',segmentPath:'FTX',requirements:['O','O','O','O','O','O','O','O','O','O','O','O','O']},
  {fieldNumber:'207',fieldKey:'sender_ediel_id',segmentPath:'UNB/S002',requirements:['R','R','R','R','R','R','R','R','R','R','R','R','R']},
  {fieldNumber:'315',fieldKey:'sender_organisation_no',segmentPath:'NAD+FR',requirements:['-','-','O','-','-','-','-','-','-','-','-','-','-']},
  {fieldNumber:'208',fieldKey:'receiver_ediel_id',segmentPath:'UNB/S003',requirements:['R','R','R','R','R','R','R','R','R','R','R','R','R']},
  {fieldNumber:'314',fieldKey:'sequence_number',segmentPath:'LIN',requirements:['R','R','R','R','R','R','R','R','R','R','R','R','R']},
  {fieldNumber:'209',fieldKey:'line_item',segmentPath:'LIN',requirements:['R','R','R','R','R','R','R','R','R','-','D','R','R']},
  {fieldNumber:'258',fieldKey:'sub_line_number',segmentPath:'LIN',requirements:['-','-','-','D','-','D','-','-','D','-','-','-','-']},
  {fieldNumber:'210',fieldKey:'contract_start_date',segmentPath:'DTM+92',requirements:['R','-','R','R','-','D','-','D','D','-','-','-','-']},
  {fieldNumber:'211',fieldKey:'contract_stop_date',segmentPath:'DTM+93',requirements:['-','-','-','-','R','O','R','D','-','-','-','-','-']},
  {fieldNumber:'302',fieldKey:'report_start_date',segmentPath:'DTM+163',requirements:['-','-','-','O','-','-','-','-','-','R','D','-','-']},
  {fieldNumber:'321',fieldKey:'report_end_date',segmentPath:'DTM+164',requirements:['-','-','-','-','-','-','-','-','-','D','D','-','-']},
  {fieldNumber:'216',fieldKey:'validity_start_date',segmentPath:'DTM+157',requirements:['-','-','-','-','-','R','-','D','R','-','-','-','-']},
  {fieldNumber:'212',fieldKey:'first_meter_reading_date',segmentPath:'DTM+9',requirements:['-','-','-','O','-','-','-','-','-','-','-','-','-']},
  {fieldNumber:'249',fieldKey:'date_of_birth',segmentPath:'DTM+329',requirements:['O','O','O','O','O','O','O','-','-','-','-','-','-']},
  {fieldNumber:'508',fieldKey:'observation_length',segmentPath:'CCI++Z03/CAV',requirements:['-','-','-','R','-','D','-','-','R','-','D','-','-']},
  {fieldNumber:'326',fieldKey:'permission_creation_timestamp',segmentPath:'DTM+171',requirements:['-','-','-','-','-','-','-','-','-','-','D','O','O']},
  {fieldNumber:'327',fieldKey:'processing_end_timestamp',segmentPath:'DTM+273',requirements:['-','-','-','-','-','-','-','-','-','-','-','R','R']},
  {fieldNumber:'303',fieldKey:'free_text_item_level',segmentPath:'FTX',requirements:['O','O','O','O','O','O','O','-','O','-','-','-','-']},
  {fieldNumber:'213',fieldKey:'estimated_annual_volume',segmentPath:'QTY+31',requirements:['-','-','O','R','-','O','-','-','O','-','-','-','-']},
  {fieldNumber:'214',fieldKey:'constant',segmentPath:'QTY+40',requirements:['-','-','-','D','-','D','-','-','D','-','-','-','-']},
  {fieldNumber:'215',fieldKey:'old_constant',segmentPath:'QTY+40',requirements:['-','-','-','-','-','-','-','-','O','-','-','-','-']},
  {fieldNumber:'217',fieldKey:'measure_method',segmentPath:'CCI++Z04/CAV',requirements:['-','R','R','R','-','D','-','D','R','R','D','-','-']},
  {fieldNumber:'218',fieldKey:'number_of_digits',segmentPath:'QTY+218',requirements:['-','-','-','D','-','D','-','-','D','-','-','-','-']},
  {fieldNumber:'219',fieldKey:'old_number_of_digits',segmentPath:'QTY+219',requirements:['-','-','-','-','-','-','-','-','O','-','-','-','-']},
  {fieldNumber:'306',fieldKey:'installation_status',segmentPath:'CCI++Z05/CAV',requirements:['-','-','-','R','-','D','-','-','-','-','-','-','-']},
  {fieldNumber:'307',fieldKey:'tariff_code',segmentPath:'CCI++Z06/CAV',requirements:['-','-','-','O','-','O','-','-','-','-','-','-','-']},
  {fieldNumber:'220',fieldKey:'priority',segmentPath:'CCI++Z07/CAV',requirements:['-','-','-','O','-','O','-','-','-','-','-','-','-']},
  {fieldNumber:'222',fieldKey:'reporting_frequency',segmentPath:'CCI++Z12/CAV',requirements:['-','-','-','R','-','R','-','-','R','R','D','-','-']},
  {fieldNumber:'223',fieldKey:'reason_for_transaction',segmentPath:'CCI++Z13/CAV',requirements:['R','R','R','R','R','R','R','R','R','R','R','R','R']},
  {fieldNumber:'259',fieldKey:'meter_time_frame',segmentPath:'CCI++Z15/CAV',requirements:['-','-','-','D','-','D','-','-','D','-','-','-','-']},
  {fieldNumber:'254',fieldKey:'balance_settlement_method',segmentPath:'CCI++Z16/CAV',requirements:['-','-','-','R','-','D','-','-','D','-','-','-','-']},
  {fieldNumber:'242',fieldKey:'product_code',segmentPath:'CCI++Z17/CAV',requirements:['-','-','-','R','-','D','-','-','D','-','-','-','-']},
  {fieldNumber:'506',fieldKey:'energy_product',segmentPath:'CCI++Z14/CAV',requirements:['-','-','-','-','-','-','-','-','-','R','D','-','-']},
  {fieldNumber:'310',fieldKey:'party_connected_to_grid_status',segmentPath:'CCI++Z18/CAV',requirements:['-','-','-','-','D','D','-','D','-','-','-','-','-']},
  {fieldNumber:'513',fieldKey:'installation_direction',segmentPath:'CCI++Z22/CAV',requirements:['-','-','-','-','-','-','-','-','-','R','D','-','-']},
  {fieldNumber:'322',fieldKey:'permission_status',segmentPath:'CCI++Z23/CAV',requirements:['-','-','-','-','-','-','-','-','-','-','R','R','-']},
  {fieldNumber:'323',fieldKey:'permission_purpose',segmentPath:'CCI++Z24/CAV',requirements:['-','-','-','-','-','-','-','-','-','D','D','-','-']},
  {fieldNumber:'324',fieldKey:'permission_end_reason',segmentPath:'CCI++Z25/CAV',requirements:['-','-','-','-','-','-','-','-','-','-','-','R','R']},
  {fieldNumber:'224',fieldKey:'meter_number',segmentPath:'RFF+MG',requirements:['-','-','-','R','O','O','O','-','R','-','-','-','-']},
  {fieldNumber:'225',fieldKey:'old_meter_number',segmentPath:'RFF+MG',requirements:['-','-','-','-','-','-','-','-','R','-','-','-','-']},
  {fieldNumber:'308',fieldKey:'supplier_contract_no',segmentPath:'RFF+CT',requirements:['-','-','O','-','O','O','O','-','-','-','-','-','-']},
  {fieldNumber:'260',fieldKey:'net_area',segmentPath:'RFF+Z05',requirements:['R','R','R','R','R','R','R','R','R','-','D','R','R']},
  {fieldNumber:'320',fieldKey:'calorific_value_area',segmentPath:'RFF+Z10',requirements:['-','-','-','D','-','D','-','-','-','-','-','-','-']},
  {fieldNumber:'240',fieldKey:'serial_id',segmentPath:'RFF+SI',requirements:['-','-','-','D','O','D','-','-','D','-','-','-','-']},
  {fieldNumber:'319',fieldKey:'reference_to_metering_point',segmentPath:'RFF+Z07',requirements:['-','-','-','D','-','-','-','-','-','-','-','-','-']},
  {fieldNumber:'261',fieldKey:'agreement_reference',segmentPath:'RFF+ANJ',requirements:['R','-','R','-','-','-','-','-','-','R','-','-','-']},
  {fieldNumber:'226',fieldKey:'line_reference',segmentPath:'RFF+LI',requirements:['R','R','R','R','R','R','R','R','R','R','R','R','R']},
  {fieldNumber:'325',fieldKey:'permission_id',segmentPath:'RFF+ZPI',requirements:['-','-','-','-','-','-','-','-','-','-','D','R','R']},
  {fieldNumber:'END_USER_GROUP',fieldKey:'end_user_group',segmentPath:'NAD+UD',requirements:['R','R','R','R','R','D','R','D','-','R','D','R','R']},
  {fieldNumber:'227',fieldKey:'end_user_id',segmentPath:'NAD+UD',requirements:['R','R','R','R','R','D','R','D','-','R','D','R','R']},
  {fieldNumber:'228',fieldKey:'end_user_name',segmentPath:'NAD+UD',requirements:['R','R','R','R','R','D','R','D','-','R','D','R','R']},
  {fieldNumber:'229',fieldKey:'end_user_address',segmentPath:'NAD+UD',requirements:['D','D','D','D','D','D','D','D','-','-','-','-','-']},
  {fieldNumber:'231',fieldKey:'end_user_postcode',segmentPath:'NAD+UD',requirements:['R','R','R','R','R','D','R','D','-','-','-','-','-']},
  {fieldNumber:'232',fieldKey:'end_user_city',segmentPath:'NAD+UD',requirements:['R','R','R','R','R','D','R','D','-','-','-','-','-']},
  {fieldNumber:'316',fieldKey:'end_user_country',segmentPath:'NAD+UD',requirements:['R','R','R','R','R','D','R','D','-','R','R','R','R']},
  {fieldNumber:'INSTALLATION_GROUP',fieldKey:'installation_group',segmentPath:'NAD+IT',requirements:['O','R','O','R','R','R','O','-','-','-','D','-','-']},
  {fieldNumber:'233',fieldKey:'installation_id',segmentPath:'NAD+IT',requirements:['D','R','D','R','R','R','D','-','-','-','R','-','-']},
  {fieldNumber:'234',fieldKey:'installation_address',segmentPath:'NAD+IT',requirements:['D','R','D','R','R','R','D','-','-','-','R','-','-']},
  {fieldNumber:'235',fieldKey:'installation_postcode',segmentPath:'NAD+IT',requirements:['O','O','O','O','O','O','O','-','-','-','O','-','-']},
  {fieldNumber:'236',fieldKey:'installation_city',segmentPath:'NAD+IT',requirements:['O','O','O','O','O','O','O','-','-','-','O','-','-']},
  {fieldNumber:'237',fieldKey:'installation_country',segmentPath:'NAD+IT',requirements:['O','O','O','O','O','O','O','-','-','-','O','-','-']},
  {fieldNumber:'INVOICEE_GROUP',fieldKey:'invoicee_group',segmentPath:'NAD+IV',requirements:['-','-','D','D','D','D','D','D','-','-','-','-','-']},
  {fieldNumber:'250',fieldKey:'invoicee_id',segmentPath:'NAD+IV',requirements:['-','-','D','D','D','D','D','D','-','-','-','-','-']},
  {fieldNumber:'251',fieldKey:'invoicee_name',segmentPath:'NAD+IV',requirements:['-','-','D','D','D','D','D','D','-','-','-','-','-']},
  {fieldNumber:'252',fieldKey:'invoicee_address',segmentPath:'NAD+IV',requirements:['-','-','D','D','D','D','D','D','-','-','-','-','-']},
  {fieldNumber:'253',fieldKey:'invoicee_postcode',segmentPath:'NAD+IV',requirements:['-','-','D','D','D','D','D','D','-','-','-','-','-']},
  {fieldNumber:'317',fieldKey:'invoicee_city',segmentPath:'NAD+IV',requirements:['-','-','D','D','D','D','D','D','-','-','-','-','-']},
  {fieldNumber:'318',fieldKey:'invoicee_country',segmentPath:'NAD+IV',requirements:['-','-','D','D','D','D','D','D','-','-','-','-','-']},
  {fieldNumber:'262',fieldKey:'balance_responsible',segmentPath:'NAD+Z02',requirements:['-','-','R','R','R','R','R','R','R','-','-','-','-']},
] as const

const REQUIREMENT_MAP: Record<Prodat26ARequirement, RulebookFieldRule['requirement']> = {
  R: 'required',
  D: 'dependent',
  O: 'optional',
  '-': 'forbidden',
}

export function canonicalProdat26AFieldRules(code: string | null | undefined): RulebookFieldRule[] {
  const normalized = String(code ?? '').trim().toUpperCase() as Prodat26AMessageCode
  const index = PRODAT_26A_MESSAGE_CODES.indexOf(normalized)
  if (index < 0) return []
  return PRODAT_26A_FIELD_MATRIX.map((row) => ({
    family: 'PRODAT',
    code: normalized,
    fieldNumber: row.fieldNumber,
    fieldKey: row.fieldKey,
    label: row.fieldKey,
    segmentPath: row.segmentPath,
    requirement: REQUIREMENT_MAP[row.requirements[index]],
    source: 'static',
  }))
}

export function assertCanonicalProdat26AMatrixComplete(): void {
  if (PRODAT_26A_FIELD_MATRIX.length !== 77) throw new Error(`prodat_26a_field_matrix_row_count:${PRODAT_26A_FIELD_MATRIX.length}`)
  for (const row of PRODAT_26A_FIELD_MATRIX) {
    if (row.requirements.length !== PRODAT_26A_MESSAGE_CODES.length) {
      throw new Error(`prodat_26a_field_matrix_width:${row.fieldNumber}:${row.requirements.length}`)
    }
  }
}
