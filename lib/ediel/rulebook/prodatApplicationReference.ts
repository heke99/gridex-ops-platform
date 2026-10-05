export type ProdatApplicationReference = '23-DDQ-PRODAT' | '23-DGI-PRODAT'

export type ProdatApplicationReferenceProcessGroup =
  | 'supplier_switch'
  | 'customer_masterdata'
  | 'delivery_contract'
  | 'masterdata'
  | 'metering'
  | 'metering_access'

/**
 * Canonical PRODAT Application Reference authority.
 *
 * The Swedish PRODAT process group determines the exact Application Reference.
 * No route, DB row, builder or compatibility layer may manufacture a fallback.
 */
export function canonicalProdatApplicationReferenceForProcessGroup(
  processGroup: ProdatApplicationReferenceProcessGroup,
): ProdatApplicationReference {
  if (processGroup === 'metering_access') return '23-DGI-PRODAT'
  return '23-DDQ-PRODAT'
}
