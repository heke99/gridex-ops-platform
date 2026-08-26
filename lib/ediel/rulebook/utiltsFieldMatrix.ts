export type UtiltsFieldRequirement = 'R' | 'D' | 'O' | 'X'

export type UtiltsCurrentMessageCode =
  | 'E30' | 'E31' | 'E66' | 'E72' | 'E73' | 'E74'
  | 'S01' | 'S02' | 'S03' | 'S04' | 'S05' | 'S06' | 'S07'

export type UtiltsFieldScope = 'header' | 'transaction' | 'observation'

export type UtiltsFieldRule = {
  ruleKey: string
  fieldNo: string
  semanticKey: string
  fieldLabel: string
  segmentPath: string
  scope: UtiltsFieldScope
  requirements: Readonly<Partial<Record<UtiltsCurrentMessageCode, UtiltsFieldRequirement>>>
  condition?: string
  sourceGuide: '25-A-3'
}

const normalCodes: readonly UtiltsCurrentMessageCode[] = [
  'E30', 'E31', 'E66', 'E72', 'E73', 'E74',
  'S01', 'S02', 'S03', 'S04', 'S05', 'S06', 'S07',
] as const

function all(requirement: UtiltsFieldRequirement): Readonly<Record<UtiltsCurrentMessageCode, UtiltsFieldRequirement>> {
  return Object.fromEntries(normalCodes.map((code) => [code, requirement])) as Record<UtiltsCurrentMessageCode, UtiltsFieldRequirement>
}

function rule(input: Omit<UtiltsFieldRule, 'sourceGuide'>): UtiltsFieldRule {
  return { ...input, sourceGuide: '25-A-3' }
}

/**
 * Svenska kraftnät UTILTS/APERAK 25-A-3, E5SE5A, valid from 2025-06-01.
 *
 * R = required, D = dependent/conditional, O = optional, X = forbidden in the
 * represented message/value model. Conditional rows are intentionally not
 * promoted to R here: their product/object/value-mode conditions are evaluated
 * by semantic validation after parsing.
 *
 * Field 520 occurs in several different value branches. Each occurrence has a
 * distinct semanticKey so meter-reading quality, quantity quality and maximum-
 * power quality can never overwrite one another in the canonical model.
 */
export const UTILTS_25_A_3_FIELD_RULES: readonly UtiltsFieldRule[] = [
  // Common header for all current normal/request UTILTS message codes.
  rule({ ruleKey: '311_application_reference', fieldNo: '311', semanticKey: 'application_reference', fieldLabel: 'Application Reference', segmentPath: 'UNB/0026', scope: 'header', requirements: all('R') }),
  rule({ ruleKey: '312_association_assigned_code', fieldNo: '312', semanticKey: 'association_assigned_code', fieldLabel: 'Association assigned code', segmentPath: 'UNH/S009/0057', scope: 'header', requirements: all('R') }),
  rule({ ruleKey: '202_document_name_code', fieldNo: '202', semanticKey: 'document_name_code', fieldLabel: 'Document name code', segmentPath: 'BGM/C002/1001', scope: 'header', requirements: all('R') }),
  rule({ ruleKey: '203_document_identifier', fieldNo: '203', semanticKey: 'document_identifier', fieldLabel: 'Document identifier', segmentPath: 'BGM/C106/1004', scope: 'header', requirements: all('R') }),
  rule({ ruleKey: '204_message_function', fieldNo: '204', semanticKey: 'message_function', fieldLabel: 'Message function', segmentPath: 'BGM/1225', scope: 'header', requirements: all('R') }),
  rule({ ruleKey: '313_request_acknowledgement', fieldNo: '313', semanticKey: 'request_acknowledgement', fieldLabel: 'Request for acknowledgement', segmentPath: 'BGM/4343', scope: 'header', requirements: all('R') }),
  rule({ ruleKey: '205_message_date', fieldNo: '205', semanticKey: 'message_date', fieldLabel: 'Message date', segmentPath: 'DTM+137/C507/2380', scope: 'header', requirements: all('R') }),
  rule({ ruleKey: '206_timezone', fieldNo: '206', semanticKey: 'timezone_offset', fieldLabel: 'Time zone', segmentPath: 'DTM+735/C507/2380', scope: 'header', requirements: all('R') }),
  rule({ ruleKey: '501_sector_area', fieldNo: '501', semanticKey: 'sector_area', fieldLabel: 'Sector area', segmentPath: 'MKS/7293', scope: 'header', requirements: all('R') }),
  rule({ ruleKey: '502_phase_domain', fieldNo: '502', semanticKey: 'phase_domain', fieldLabel: 'Phase / Domain', segmentPath: 'MKS/C332/3496', scope: 'header', requirements: all('R') }),
  rule({ ruleKey: '207_sender', fieldNo: '207', semanticKey: 'sender_ediel_id', fieldLabel: 'Sender', segmentPath: 'SG2/NAD+MS/C082/3039', scope: 'header', requirements: all('R') }),
  rule({ ruleKey: '208_receiver', fieldNo: '208', semanticKey: 'receiver_ediel_id', fieldLabel: 'Recipient', segmentPath: 'SG2/NAD+MR/C082/3039', scope: 'header', requirements: all('R') }),
  rule({ ruleKey: '509_ancillary_role', fieldNo: '509', semanticKey: 'ancillary_role', fieldLabel: 'Ancillary role', segmentPath: 'SG2/NAD/<role>/3035', scope: 'header', requirements: all('R'), condition: 'Role qualifier is resolved from the message-specific actor rule.' }),

  // Planning matrix S02/S03/S04.
  rule({ ruleKey: 'planning_505_transaction_id', fieldNo: '505', semanticKey: 'transaction_id', fieldLabel: 'Transaction id', segmentPath: 'SG5/IDE+24/C206/7402', scope: 'transaction', requirements: { S02: 'R', S03: 'R', S04: 'R' } }),
  rule({ ruleKey: 'planning_209_metering_point', fieldNo: '209', semanticKey: 'metering_point_id', fieldLabel: 'Metering point id', segmentPath: 'SG5/LOC+172/C517/3225', scope: 'transaction', requirements: { S02: 'R', S03: 'X', S04: 'X' } }),
  rule({ ruleKey: 'planning_260a_grid_area', fieldNo: '260a', semanticKey: 'grid_area_id', fieldLabel: 'Metering grid area', segmentPath: 'SG5/LOC+239/C517/3225', scope: 'transaction', requirements: { S02: 'R', S03: 'R', S04: 'R' } }),
  rule({ ruleKey: 'planning_262_balance_responsible', fieldNo: '262', semanticKey: 'balance_responsible_id', fieldLabel: 'Balance responsible', segmentPath: 'SG5/NAD+DDK/C082/3039', scope: 'transaction', requirements: { S02: 'X', S03: 'D', S04: 'D' } }),
  rule({ ruleKey: 'planning_510_balance_supplier', fieldNo: '510', semanticKey: 'balance_supplier_id', fieldLabel: 'Balance supplier', segmentPath: 'SG5/NAD+DDQ/C082/3039', scope: 'transaction', requirements: { S02: 'X', S03: 'D', S04: 'X' } }),
  rule({ ruleKey: 'planning_506_product', fieldNo: '506', semanticKey: 'product_id', fieldLabel: 'Product identification', segmentPath: 'SG5/LIN/C212/7140', scope: 'transaction', requirements: { S02: 'R', S03: 'R', S04: 'R' } }),
  rule({ ruleKey: 'planning_511_time_series_product', fieldNo: '511', semanticKey: 'time_series_product', fieldLabel: 'Time series product', segmentPath: 'SG5/PIA+1/C212/7140', scope: 'transaction', requirements: { S02: 'X', S03: 'R', S04: 'R' } }),
  rule({ ruleKey: 'planning_245_delivery_period', fieldNo: '245', semanticKey: 'delivery_period', fieldLabel: 'Delivery period', segmentPath: 'SG5/DTM+324/C507/2380', scope: 'transaction', requirements: { S02: 'R', S03: 'R', S04: 'R' } }),
  rule({ ruleKey: 'planning_532_latest_update', fieldNo: '532', semanticKey: 'latest_update_date', fieldLabel: 'Latest update date', segmentPath: 'SG5/DTM+368/C507/2380', scope: 'transaction', requirements: { S02: 'R', S03: 'R', S04: 'R' } }),
  rule({ ruleKey: 'planning_508_resolution', fieldNo: '508', semanticKey: 'resolution', fieldLabel: 'Resolution', segmentPath: 'SG5/DTM+354/C507/2380', scope: 'transaction', requirements: { S02: 'R', S03: 'R', S04: 'R' } }),
  rule({ ruleKey: 'planning_223_reason', fieldNo: '223', semanticKey: 'reason_for_transaction', fieldLabel: 'Reason for transaction', segmentPath: 'SG5/STS+7/C556/9013', scope: 'transaction', requirements: { S02: 'R', S03: 'R', S04: 'R' } }),
  rule({ ruleKey: 'planning_264_unit', fieldNo: '264', semanticKey: 'unit', fieldLabel: 'Unit', segmentPath: 'SG5/MEA+AAZ/C174/6411', scope: 'transaction', requirements: { S02: 'R', S03: 'R', S04: 'R' } }),
  rule({ ruleKey: 'planning_226_prodat_reference', fieldNo: '226', semanticKey: 'prodat_transaction_reference', fieldLabel: 'PRODAT transaction reference', segmentPath: 'SG6/RFF+TN/C506/1154', scope: 'transaction', requirements: { S02: 'O', S03: 'X', S04: 'X' } }),
  rule({ ruleKey: 'planning_254_settlement_method', fieldNo: '254', semanticKey: 'settlement_method', fieldLabel: 'Settlement method', segmentPath: 'SG7/CCI+++E02/CAV/C889/7111', scope: 'transaction', requirements: { S02: 'X', S03: 'R', S04: 'X' } }),
  rule({ ruleKey: 'planning_513_metering_point_type', fieldNo: '513', semanticKey: 'metering_point_type', fieldLabel: 'Metering point type', segmentPath: 'SG7/CCI+++E12/CAV/C889/7111', scope: 'transaction', requirements: { S02: 'X', S03: 'R', S04: 'X' } }),
  rule({ ruleKey: 'planning_507a_default_metering_points', fieldNo: '507a', semanticKey: 'default_metering_point_count', fieldLabel: 'Default number of metering points', segmentPath: 'SG7/CCI+++Z01/CAV/C889/7110', scope: 'transaction', requirements: { S02: 'X', S03: 'D', S04: 'X' } }),
  rule({ ruleKey: 'planning_514_observation_id', fieldNo: '514', semanticKey: 'observation_id', fieldLabel: 'Observation id', segmentPath: 'SG8/SEQ/C286/1050', scope: 'observation', requirements: { S02: 'R', S03: 'R', S04: 'R' } }),
  rule({ ruleKey: 'planning_515_planned_quantity', fieldNo: '515', semanticKey: 'planned_periodic_quantity', fieldLabel: 'Period quantity planned', segmentPath: 'SG11/QTY+135/C186/6060', scope: 'observation', requirements: { S02: 'R', S03: 'R', S04: 'R' } }),
  rule({ ruleKey: 'planning_520_quantity_quality', fieldNo: '520', semanticKey: 'planned_quantity_quality', fieldLabel: 'Quantity quality', segmentPath: 'SG11/STS+8/C555/4405', scope: 'observation', requirements: { S02: 'D', S03: 'X', S04: 'X' }, condition: 'Required in S02 when field 515 has lower quality than approved.' }),
  rule({ ruleKey: 'planning_507b_diverging_metering_points', fieldNo: '507b', semanticKey: 'diverging_metering_point_count', fieldLabel: 'Diverging number of metering points', segmentPath: 'SG12/CCI+++Z01/CAV/C889/7110', scope: 'observation', requirements: { S02: 'X', S03: 'D', S04: 'X' } }),

  // Metering / settlement transaction matrix E30/E31/E66/S01/S05/S07.
  rule({ ruleKey: 'ops_505_transaction_id', fieldNo: '505', semanticKey: 'transaction_id', fieldLabel: 'Transaction id', segmentPath: 'SG5/IDE+24/C206/7402', scope: 'transaction', requirements: { E30: 'R', E31: 'R', E66: 'R', S01: 'R', S05: 'R', S07: 'R' } }),
  rule({ ruleKey: 'ops_209_metering_point', fieldNo: '209', semanticKey: 'metering_point_id', fieldLabel: 'Metering point id', segmentPath: 'SG5/LOC+172/C517/3225', scope: 'transaction', requirements: { E30: 'R', E31: 'X', E66: 'D', S01: 'X', S05: 'X', S07: 'R' }, condition: 'E66 uses 209 for normal accounting-point data; regulating-object data uses field 533.' }),
  rule({ ruleKey: 'ops_533_station_group', fieldNo: '533', semanticKey: 'station_group_id', fieldLabel: 'Station group id', segmentPath: 'SG5/LOC+175/C517/3225', scope: 'transaction', requirements: { E30: 'X', E31: 'X', E66: 'D', S01: 'D', S05: 'X', S07: 'X' } }),
  rule({ ruleKey: 'ops_260a_grid_area', fieldNo: '260a', semanticKey: 'grid_area_id', fieldLabel: 'Metering grid area', segmentPath: 'SG5/LOC+239/C517/3225', scope: 'transaction', requirements: { E30: 'O', E31: 'D', E66: 'D', S01: 'D', S05: 'D', S07: 'D' } }),
  rule({ ruleKey: 'ops_260b_grid_area_source', fieldNo: '260b', semanticKey: 'grid_area_source_id', fieldLabel: 'Metering grid area source', segmentPath: 'SG5/LOC+232/C517/3225', scope: 'transaction', requirements: { E30: 'O', E31: 'D', E66: 'D', S01: 'D', S05: 'X', S07: 'D' }, condition: '260b and 260c are a pair.' }),
  rule({ ruleKey: 'ops_260c_grid_area_sink', fieldNo: '260c', semanticKey: 'grid_area_sink_id', fieldLabel: 'Metering grid area sink', segmentPath: 'SG5/LOC+233/C517/3225', scope: 'transaction', requirements: { E30: 'O', E31: 'D', E66: 'D', S01: 'D', S05: 'X', S07: 'D' }, condition: '260b and 260c are a pair.' }),
  rule({ ruleKey: 'ops_262_balance_responsible', fieldNo: '262', semanticKey: 'balance_responsible_id', fieldLabel: 'Balance responsible', segmentPath: 'SG5/NAD+DDK/C082/3039', scope: 'transaction', requirements: { E30: 'X', E31: 'D', E66: 'X', S01: 'D', S05: 'D', S07: 'X' } }),
  rule({ ruleKey: 'ops_510_balance_supplier', fieldNo: '510', semanticKey: 'balance_supplier_id', fieldLabel: 'Balance supplier', segmentPath: 'SG5/NAD+DDQ/C082/3039', scope: 'transaction', requirements: { E30: 'X', E31: 'D', E66: 'X', S01: 'X', S05: 'D', S07: 'X' } }),
  rule({ ruleKey: 'ops_524_buyer', fieldNo: '524', semanticKey: 'buyer_id', fieldLabel: 'Buyer', segmentPath: 'SG5/NAD+BY/C082/3039', scope: 'transaction', requirements: { E30: 'X', E31: 'X', E66: 'X', S01: 'D', S05: 'D', S07: 'X' } }),
  rule({ ruleKey: 'ops_525_seller', fieldNo: '525', semanticKey: 'seller_id', fieldLabel: 'Seller', segmentPath: 'SG5/NAD+SE/C082/3039', scope: 'transaction', requirements: { E30: 'X', E31: 'X', E66: 'X', S01: 'D', S05: 'D', S07: 'X' } }),
  rule({ ruleKey: 'ops_526_system_operator', fieldNo: '526', semanticKey: 'system_operator_id', fieldLabel: 'System operator', segmentPath: 'SG5/NAD+EZ/C082/3039', scope: 'transaction', requirements: { E30: 'X', E31: 'X', E66: 'X', S01: 'D', S05: 'D', S07: 'X' } }),
  rule({ ruleKey: 'ops_506_product', fieldNo: '506', semanticKey: 'product_id', fieldLabel: 'Product identification', segmentPath: 'SG5/LIN/C212/7140', scope: 'transaction', requirements: { E30: 'X', E31: 'R', E66: 'R', S01: 'R', S05: 'R', S07: 'R' } }),
  rule({ ruleKey: 'ops_511_time_series_product', fieldNo: '511', semanticKey: 'time_series_product', fieldLabel: 'Time series product', segmentPath: 'SG5/PIA+1/C212/7140', scope: 'transaction', requirements: { E30: 'X', E31: 'R', E66: 'X', S01: 'R', S05: 'R', S07: 'X' } }),
  rule({ ruleKey: 'ops_245_delivery_period', fieldNo: '245', semanticKey: 'delivery_period', fieldLabel: 'Delivery period', segmentPath: 'SG5/DTM+324/C507/2380', scope: 'transaction', requirements: { E30: 'D', E31: 'R', E66: 'D', S01: 'R', S05: 'R', S07: 'R' } }),
  rule({ ruleKey: 'ops_512_registration_date', fieldNo: '512', semanticKey: 'registration_date', fieldLabel: 'Registration date', segmentPath: 'SG5/DTM+597/C507/2380', scope: 'transaction', requirements: { E30: 'R', E31: 'X', E66: 'R', S01: 'X', S05: 'X', S07: 'R' } }),
  rule({ ruleKey: 'ops_532_latest_update', fieldNo: '532', semanticKey: 'latest_update_date', fieldLabel: 'Latest update date', segmentPath: 'SG5/DTM+368/C507/2380', scope: 'transaction', requirements: { E30: 'X', E31: 'R', E66: 'X', S01: 'R', S05: 'R', S07: 'X' } }),
  rule({ ruleKey: 'ops_508_resolution', fieldNo: '508', semanticKey: 'resolution', fieldLabel: 'Resolution', segmentPath: 'SG5/DTM+354/C507/2380', scope: 'transaction', requirements: { E30: 'D', E31: 'R', E66: 'D', S01: 'R', S05: 'R', S07: 'R' } }),
  rule({ ruleKey: 'ops_223_reason', fieldNo: '223', semanticKey: 'reason_for_transaction', fieldLabel: 'Reason for transaction', segmentPath: 'SG5/STS+7/C556/9013', scope: 'transaction', requirements: { E30: 'R', E31: 'R', E66: 'R', S01: 'R', S05: 'R', S07: 'R' } }),
  rule({ ruleKey: 'ops_264_unit', fieldNo: '264', semanticKey: 'unit', fieldLabel: 'Unit', segmentPath: 'SG5/MEA+AAZ/C174/6411', scope: 'transaction', requirements: { E30: 'X', E31: 'R', E66: 'R', S01: 'D', S05: 'D', S07: 'R' } }),
  rule({ ruleKey: 'ops_226_prodat_reference', fieldNo: '226', semanticKey: 'prodat_transaction_reference', fieldLabel: 'PRODAT transaction reference', segmentPath: 'SG6/RFF+TN/C506/1154', scope: 'transaction', requirements: { E30: 'X', E31: 'X', E66: 'D', S01: 'X', S05: 'X', S07: 'X' } }),
  rule({ ruleKey: 'ops_254_settlement_method', fieldNo: '254', semanticKey: 'settlement_method', fieldLabel: 'Settlement method', segmentPath: 'SG7/CCI+++E02/CAV/C889/7111', scope: 'transaction', requirements: { E30: 'X', E31: 'R', E66: 'X', S01: 'D', S05: 'D', S07: 'X' } }),
  rule({ ruleKey: 'ops_507a_default_metering_points', fieldNo: '507a', semanticKey: 'default_metering_point_count', fieldLabel: 'Default number of metering points', segmentPath: 'SG7/CCI+++Z01/CAV/C889/7110', scope: 'transaction', requirements: { E30: 'X', E31: 'D', E66: 'X', S01: 'X', S05: 'D', S07: 'X' } }),
  rule({ ruleKey: 'ops_513_metering_point_type', fieldNo: '513', semanticKey: 'metering_point_type', fieldLabel: 'Metering point type', segmentPath: 'SG7/CCI+++E12/CAV/C889/7111', scope: 'transaction', requirements: { E30: 'X', E31: 'R', E66: 'R', S01: 'X', S05: 'X', S07: 'R' } }),
  rule({ ruleKey: 'ops_514_observation_id', fieldNo: '514', semanticKey: 'observation_id', fieldLabel: 'Observation id', segmentPath: 'SG8/SEQ/C286/1050', scope: 'observation', requirements: { E30: 'R', E31: 'R', E66: 'R', S01: 'R', S05: 'R', S07: 'R' } }),
  rule({ ruleKey: 'ops_527_register_id', fieldNo: '527', semanticKey: 'register_id', fieldLabel: 'Register id', segmentPath: 'SG8/RFF+AES/C506/1154', scope: 'observation', requirements: { E30: 'D', E31: 'X', E66: 'D', S01: 'X', S05: 'X', S07: 'D' } }),
  rule({ ruleKey: 'ops_224_meter_number', fieldNo: '224', semanticKey: 'meter_number', fieldLabel: 'Meter number', segmentPath: 'SG8/RFF+MG|SE/C506/1154', scope: 'observation', requirements: { E30: 'D', E31: 'X', E66: 'D', S01: 'X', S05: 'X', S07: 'O' } }),
  rule({ ruleKey: 'ops_522_monetary_amount', fieldNo: '522', semanticKey: 'monetary_amount', fieldLabel: 'Monetary amount', segmentPath: 'SG8/MOA+9/C516/5004', scope: 'observation', requirements: { E30: 'X', E31: 'X', E66: 'X', S01: 'D', S05: 'D', S07: 'X' } }),
  rule({ ruleKey: 'ops_269a_amount_currency', fieldNo: '269a', semanticKey: 'monetary_currency', fieldLabel: 'Currency for monetary amount', segmentPath: 'SG8/MOA+9/C516/6345', scope: 'observation', requirements: { E30: 'X', E31: 'X', E66: 'X', S01: 'D', S05: 'D', S07: 'X' } }),
  rule({ ruleKey: 'ops_523_price', fieldNo: '523', semanticKey: 'price_amount', fieldLabel: 'Price amount', segmentPath: 'SG10/PRI/C509/5118', scope: 'observation', requirements: { E30: 'X', E31: 'X', E66: 'X', S01: 'D', S05: 'D', S07: 'X' } }),
  rule({ ruleKey: 'ops_269b_price_currency', fieldNo: '269b', semanticKey: 'price_currency', fieldLabel: 'Currency for price', segmentPath: 'SG10/CUX+2/6345', scope: 'observation', requirements: { E30: 'X', E31: 'X', E66: 'X', S01: 'D', S05: 'D', S07: 'X' } }),
  rule({ ruleKey: 'ops_517_meter_reading', fieldNo: '517', semanticKey: 'meter_reading', fieldLabel: 'Meter reading', segmentPath: 'SG11/QTY+220/C186/6060', scope: 'observation', requirements: { E30: 'D', E31: 'X', E66: 'D', S01: 'X', S05: 'X', S07: 'D' }, condition: 'Presence must be distinguished from the literal NULL measurement value.' }),
  rule({ ruleKey: 'ops_530a_meter_reading_date', fieldNo: '530a', semanticKey: 'meter_reading_date', fieldLabel: 'Meter reading date', segmentPath: 'SG11/DTM+597/C507/2380', scope: 'observation', requirements: { E30: 'D', E31: 'X', E66: 'D', S01: 'X', S05: 'X', S07: 'D' }, condition: 'Required when meter-reading field 517 is sent.' }),
  rule({ ruleKey: 'ops_520_meter_reading_quality', fieldNo: '520', semanticKey: 'meter_reading_quality', fieldLabel: 'Meter reading quality', segmentPath: 'SG11/STS+8/C555/4405', scope: 'observation', requirements: { E30: 'D', E31: 'X', E66: 'X', S01: 'X', S05: 'X', S07: 'X' }, condition: 'E30 meter-stand branch: required when the meter reading has lower quality than approved.' }),
  rule({ ruleKey: 'ops_309_meter_reading_origin', fieldNo: '309', semanticKey: 'meter_reading_origin', fieldLabel: 'Origin of meter stand', segmentPath: 'SG12/CCI+++E22/CAV/C889/7111', scope: 'observation', requirements: { E30: 'X', E31: 'X', E66: 'D', S01: 'X', S05: 'X', S07: 'D' } }),
  rule({ ruleKey: 'ops_516_period_quantity', fieldNo: '516', semanticKey: 'periodic_quantity', fieldLabel: 'Periodic quantity reached', segmentPath: 'SG11/QTY+136/C186/6060', scope: 'observation', requirements: { E30: 'D', E31: 'R', E66: 'D', S01: 'R', S05: 'R', S07: 'D' }, condition: 'E31/S01/S05 R applies to the energy-volume branch; the group is not used for price/amount-only branches.' }),
  rule({ ruleKey: 'ops_520_quantity_quality', fieldNo: '520', semanticKey: 'quantity_quality', fieldLabel: 'Quantity quality', segmentPath: 'SG11/STS+8/C555/4405', scope: 'observation', requirements: { E30: 'D', E31: 'D', E66: 'D', S01: 'D', S05: 'D', S07: 'D' }, condition: 'Required when field 516 has lower quality than approved; excluded where product-specific rules say so.' }),
  rule({ ruleKey: 'ops_521_maximum_power', fieldNo: '521', semanticKey: 'maximum_power', fieldLabel: 'Maximum supplied quantity', segmentPath: 'SG11/QTY+42/C186/6060', scope: 'observation', requirements: { E30: 'X', E31: 'X', E66: 'D', S01: 'X', S05: 'X', S07: 'X' } }),
  rule({ ruleKey: 'ops_530b_maximum_power_timestamp', fieldNo: '530b', semanticKey: 'maximum_power_timestamp', fieldLabel: 'Processing date for maximum power', segmentPath: 'SG11/DTM+597/C507/2380', scope: 'observation', requirements: { E30: 'X', E31: 'X', E66: 'D', S01: 'X', S05: 'X', S07: 'X' }, condition: 'Used when maximum power refers to a specific point in time, not when it covers the whole delivery period.' }),
  rule({ ruleKey: 'ops_520_maximum_power_quality', fieldNo: '520', semanticKey: 'maximum_power_quality', fieldLabel: 'Maximum power quality', segmentPath: 'SG11/STS+8/C555/4405', scope: 'observation', requirements: { E30: 'X', E31: 'X', E66: 'D', S01: 'X', S05: 'X', S07: 'X' }, condition: 'Required when maximum-power value has lower quality than approved.' }),
  rule({ ruleKey: 'ops_259_meter_time_frame', fieldNo: '259', semanticKey: 'meter_time_frame', fieldLabel: 'Meter time frame', segmentPath: 'SG12/CCI+++E07/CAV/C889/7111', scope: 'observation', requirements: { E30: 'X', E31: 'X', E66: 'D', S01: 'X', S05: 'X', S07: 'X' }, condition: 'Maximum-power branch uses E12 (Peak).' }),
  rule({ ruleKey: 'ops_507b_diverging_metering_points', fieldNo: '507b', semanticKey: 'diverging_metering_point_count', fieldLabel: 'Diverging number of metering points', segmentPath: 'SG12/CCI+++Z01/CAV/C889/7110', scope: 'observation', requirements: { E30: 'X', E31: 'D', E66: 'X', S01: 'X', S05: 'D', S07: 'X' } }),

  // Request transaction matrix E72/E73/E74/S06.
  rule({ ruleKey: 'request_505_transaction_id', fieldNo: '505', semanticKey: 'transaction_id', fieldLabel: 'Transaction id', segmentPath: 'SG5/IDE+24/C206/7402', scope: 'transaction', requirements: { E72: 'R', E73: 'R', E74: 'R', S06: 'R' } }),
  rule({ ruleKey: 'request_209_metering_point', fieldNo: '209', semanticKey: 'metering_point_id', fieldLabel: 'Metering point id', segmentPath: 'SG5/LOC+172/C517/3225', scope: 'transaction', requirements: { E72: 'R', E73: 'D', E74: 'X', S06: 'X' } }),
  rule({ ruleKey: 'request_533_station_group', fieldNo: '533', semanticKey: 'station_group_id', fieldLabel: 'Station group id', segmentPath: 'SG5/LOC+175/C517/3225', scope: 'transaction', requirements: { E72: 'X', E73: 'D', E74: 'X', S06: 'D' } }),
  rule({ ruleKey: 'request_260a_grid_area', fieldNo: '260a', semanticKey: 'grid_area_id', fieldLabel: 'Metering grid area', segmentPath: 'SG5/LOC+239/C517/3225', scope: 'transaction', requirements: { E72: 'O', E73: 'D', E74: 'D', S06: 'D' } }),
  rule({ ruleKey: 'request_260b_grid_area_source', fieldNo: '260b', semanticKey: 'grid_area_source_id', fieldLabel: 'Metering grid area source', segmentPath: 'SG5/LOC+232/C517/3225', scope: 'transaction', requirements: { E72: 'O', E73: 'D', E74: 'D', S06: 'D' }, condition: 'Always paired with 260c; requested-message subtype may forbid the source/sink representation.' }),
  rule({ ruleKey: 'request_260c_grid_area_sink', fieldNo: '260c', semanticKey: 'grid_area_sink_id', fieldLabel: 'Metering grid area sink', segmentPath: 'SG5/LOC+233/C517/3225', scope: 'transaction', requirements: { E72: 'O', E73: 'D', E74: 'D', S06: 'D' }, condition: 'Always paired with 260b; requested-message subtype may forbid the source/sink representation.' }),
  rule({ ruleKey: 'request_262_balance_responsible', fieldNo: '262', semanticKey: 'balance_responsible_id', fieldLabel: 'Balance responsible', segmentPath: 'SG5/NAD+DDK/C082/3039', scope: 'transaction', requirements: { E72: 'X', E73: 'X', E74: 'D', S06: 'D' } }),
  rule({ ruleKey: 'request_510_balance_supplier', fieldNo: '510', semanticKey: 'balance_supplier_id', fieldLabel: 'Balance supplier', segmentPath: 'SG5/NAD+DDQ/C082/3039', scope: 'transaction', requirements: { E72: 'X', E73: 'X', E74: 'D', S06: 'X' } }),
  rule({ ruleKey: 'request_524_buyer', fieldNo: '524', semanticKey: 'buyer_id', fieldLabel: 'Buyer', segmentPath: 'SG5/NAD+BY/C082/3039', scope: 'transaction', requirements: { E72: 'X', E73: 'X', E74: 'X', S06: 'D' } }),
  rule({ ruleKey: 'request_525_seller', fieldNo: '525', semanticKey: 'seller_id', fieldLabel: 'Seller', segmentPath: 'SG5/NAD+SE/C082/3039', scope: 'transaction', requirements: { E72: 'X', E73: 'X', E74: 'X', S06: 'D' } }),
  rule({ ruleKey: 'request_526_system_operator', fieldNo: '526', semanticKey: 'system_operator_id', fieldLabel: 'System operator', segmentPath: 'SG5/NAD+EZ/C082/3039', scope: 'transaction', requirements: { E72: 'X', E73: 'X', E74: 'X', S06: 'D' } }),
  rule({ ruleKey: 'request_506_product', fieldNo: '506', semanticKey: 'product_id', fieldLabel: 'Product identification', segmentPath: 'SG5/LIN/C212/7140', scope: 'transaction', requirements: { E72: 'X', E73: 'R', E74: 'X', S06: 'X' } }),
  rule({ ruleKey: 'request_511_time_series_product', fieldNo: '511', semanticKey: 'time_series_product', fieldLabel: 'Time series product', segmentPath: 'SG5/PIA+1/C212/7140', scope: 'transaction', requirements: { E72: 'X', E73: 'X', E74: 'R', S06: 'R' } }),
  rule({ ruleKey: 'request_245_delivery_period', fieldNo: '245', semanticKey: 'delivery_period', fieldLabel: 'Requested delivery period', segmentPath: 'SG5/DTM+324/C507/2380', scope: 'transaction', requirements: { E72: 'R', E73: 'R', E74: 'R', S06: 'R' } }),
  rule({ ruleKey: 'request_223_reason', fieldNo: '223', semanticKey: 'reason_for_transaction', fieldLabel: 'Reason for transaction', segmentPath: 'SG5/STS+7/C556/9013', scope: 'transaction', requirements: { E72: 'R', E73: 'R', E74: 'R', S06: 'R' } }),
  rule({ ruleKey: 'request_503_requested_message_type', fieldNo: '503', semanticKey: 'requested_message_type', fieldLabel: 'Reference to requested UTILTS message type', segmentPath: 'SG6/RFF/C506/1153', scope: 'transaction', requirements: { E72: 'R', E73: 'R', E74: 'R', S06: 'R' } }),
  rule({ ruleKey: 'request_254_settlement_method', fieldNo: '254', semanticKey: 'settlement_method', fieldLabel: 'Settlement method', segmentPath: 'SG7/CCI+++E02/CAV/C889/7111', scope: 'transaction', requirements: { E72: 'X', E73: 'X', E74: 'R', S06: 'X' } }),
  rule({ ruleKey: 'request_513_metering_point_type', fieldNo: '513', semanticKey: 'metering_point_type', fieldLabel: 'Metering point type', segmentPath: 'SG7/CCI+++E12/CAV/C889/7111', scope: 'transaction', requirements: { E72: 'X', E73: 'R', E74: 'R', S06: 'X' } }),
] as const

export function getUtiltsFieldRules(messageCode: string | null | undefined): readonly UtiltsFieldRule[] {
  const code = String(messageCode ?? '').trim().toUpperCase() as UtiltsCurrentMessageCode
  if (!normalCodes.includes(code)) return []
  return UTILTS_25_A_3_FIELD_RULES.filter((entry) => entry.requirements[code] != null)
}

export function getUtiltsFieldRequirement(
  messageCode: string | null | undefined,
  fieldNo: string,
  semanticKey?: string,
): UtiltsFieldRequirement | null {
  const code = String(messageCode ?? '').trim().toUpperCase() as UtiltsCurrentMessageCode
  if (!normalCodes.includes(code)) return null

  const matches = UTILTS_25_A_3_FIELD_RULES.filter((entry) =>
    entry.fieldNo === fieldNo &&
    entry.requirements[code] != null &&
    (!semanticKey || entry.semanticKey === semanticKey),
  )

  if (matches.length === 0) return null
  if (matches.length > 1 && !semanticKey) {
    throw new Error(`utilts_field_semantic_key_required:${code}:${fieldNo}`)
  }
  return matches[0].requirements[code] ?? null
}

export function assertUtiltsFieldMatrixConsistency(): void {
  const keys = new Set<string>()
  for (const entry of UTILTS_25_A_3_FIELD_RULES) {
    if (keys.has(entry.ruleKey)) throw new Error(`utilts_field_rule_duplicate:${entry.ruleKey}`)
    keys.add(entry.ruleKey)

    for (const [code, requirement] of Object.entries(entry.requirements)) {
      if (!normalCodes.includes(code as UtiltsCurrentMessageCode)) {
        throw new Error(`utilts_field_rule_unknown_message:${entry.ruleKey}:${code}`)
      }
      if (!['R', 'D', 'O', 'X'].includes(String(requirement))) {
        throw new Error(`utilts_field_rule_invalid_requirement:${entry.ruleKey}:${String(requirement)}`)
      }
    }
  }
}
