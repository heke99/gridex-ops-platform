import type {CustomerContractRow} from './types'

type EditableContract = CustomerContractRow & {
  contract_price_snapshot_id?: string | null
  quote_reference?: string | null
  discount_months?: number | null
}
const unsignedStates = new Set(['draft', 'pending_signature', 'signature_failed'])
export function usesAtomicUnsignedEdit(contract: EditableContract): boolean {
  return unsignedStates.has(contract.status) && !contract.signed_at && !contract.locked_at && Boolean(
    contract.contract_offer_id || contract.public_contract_offer_id || contract.contract_publication_version_id ||
    contract.price_plan_version_id || contract.contract_price_snapshot_id,
  )
}

/** Eligibility is advisory; the RPC validates the authoritative immutable
 * ledger. Ordinary full component arrays must remain eligible after an edit. */
export function unsignedRevisionBlocker(contract: EditableContract): string | null {
  if (!usesAtomicUnsignedEdit(contract)) return 'Avtalet kan inte ändras som ett osignerat avtalsförslag.'
  if (contract.energy_direction === 'production' || !['fixed','variable_monthly','variable_hourly','variable_quarterly'].includes(contract.contract_type)) {
    return 'Denna prismodell behöver ändras genom sin avtalsmall så att hela prisunderlaget bevaras.'
  }
  const snapshot = contract.price_snapshot ?? {}
  const production = snapshot.production as {enabled?: boolean} | undefined
  const portfolio = snapshot.portfolio as {enabled?: boolean} | undefined
  const selected = snapshot.selected_component_references
  if (contract.quote_reference || (contract.optional_fee_lines?.length ?? 0) > 0 || contract.discount_value != null || contract.discount_months != null ||
    production?.enabled || portfolio?.enabled || (Array.isArray(selected) && selected.length > 0)) {
    return 'Avtalet har särskilda prisval eller komponenter. Skapa en ny version genom avtalsmallen för att bevara dessa.'
  }
  if (contract.vat_rate == null || Number(contract.vat_rate) !== 0.25) return 'Det äldre momsunderlaget behöver hanteras genom en ny avtalsmall innan nya konsumtionspriser kan säljas.'
  return null
}

const numericFields = ['fixed_price_ore_per_kwh','spot_markup_ore_per_kwh','variable_fee_ore_per_kwh',
  'monthly_fee_sek','invoice_fee_sek','green_fee_value','discount_value','start_fee_sek','admin_fee_sek','break_fee_sek','vat_rate',
  'binding_months','notice_months','auto_renew_term_months'] as const
const textFields = ['contract_name','contract_type','campaign_name','campaign_code','campaign_version','price_version','terms_version',
  'green_fee_mode','discount_unit','starts_at','ends_at','site_id','metering_point_id','override_reason'] as const
const noncommercial = new Set(['site_id','metering_point_id','override_reason'])
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
export type UnsignedEditPreparation =
  | {ok: false; field?: string; message: string}
  | {ok: true; editId: string; expectedUpdatedAt: string; patch: Record<string, string | number | boolean | null>; acknowledgeCurrentTerms: boolean; commercialChange: boolean}

export function prepareUnsignedContractEdit(contract: EditableContract, form: FormData): UnsignedEditPreparation {
  if (!usesAtomicUnsignedEdit(contract)) return {ok:false, message:'Avtalet har ändrats eller signerats. Ladda om kundkortet innan du fortsätter.'}
  const editId = String(form.get('edit_request_id') ?? '').trim()
  const expectedUpdatedAt = String(form.get('expected_updated_at') ?? '').trim()
  if (!uuid.test(editId) || !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(expectedUpdatedAt) || !Number.isFinite(Date.parse(expectedUpdatedAt))) {
    return {ok:false, message:'Redigeringsunderlaget saknas. Ladda om kundkortet och försök igen.'}
  }
  if (form.has('status') && String(form.get('status')) !== contract.status) {
    return {ok:false, field:'status', message:'Använd avtalets åtgärder för att ändra status. En sparning kan inte registrera signering eller aktivering.'}
  }
  const patch: Record<string,string | number | boolean | null> = {}
  let commercialChange = false
  for (const field of numericFields) {
    if (!form.has(field)) continue
    const raw = String(form.get(field) ?? '').trim().replace(',', '.')
    if (raw && !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw)) return {ok:false, field, message:'Ange ett giltigt belopp eller antal, exempelvis 12,50 eller 0.'}
    let next = raw ? Number(raw) : null
    if (next !== null && (!Number.isFinite(next) || (field.endsWith('_months') && !Number.isInteger(next)))) return {ok:false, field, message:'Ange ett giltigt helt antal månader.'}
    if (field === 'vat_rate' && next !== null) next /= 100
    const current = contract[field as keyof EditableContract] ?? null
    patch[field] = next
    if (next !== (current === null ? null : Number(current))) commercialChange = true
  }
  for (const field of textFields) {
    if (!form.has(field)) continue
    const raw = String(form.get(field) ?? '').trim()
    const next = raw || (field === 'green_fee_mode' ? 'none' : null)
    const stored = (field === 'site_id' ? contract.customer_site_id ?? contract.site_id : contract[field as keyof EditableContract]) ?? null
    const current = (field === 'starts_at' || field === 'ends_at') && typeof stored === 'string' ? stored.slice(0,10) : stored
    patch[field] = next
    if (next !== current && !noncommercial.has(field)) commercialChange = true
  }
  // Distinguish an unchecked rendered checkbox from an omitted field in a
  // partial request; omission alone must never clear stored renewal terms.
  const autoRenew = form.has('auto_renew_enabled') && !['','0','false','off'].includes(String(form.get('auto_renew_enabled')))
  if (form.has('auto_renew_present')) {
    patch.auto_renew_enabled = autoRenew
    if (autoRenew !== Boolean(contract.auto_renew_enabled)) commercialChange = true
  }
  if (patch.contract_name === null) return {ok:false, field:'contract_name', message:'Avtalsnamn krävs.'}
  for (const field of ['campaign_name','campaign_code','campaign_version','price_version','terms_version'] as const) {
    if (Object.hasOwn(patch,field) && patch[field] !== (contract[field] ?? null)) return {ok:false, field, message:'Kampanj- och versionsuppgifter ändras genom en ny avtalsmall. Avgifter och avtalsperiod kan ändras i detta avtalsförslag.'}
  }
  if (patch.contract_type !== undefined && !['fixed','variable_monthly','variable_hourly','variable_quarterly'].includes(String(patch.contract_type))) {
    return {ok:false, field:'contract_type', message:'Välj en giltig avtalstyp för denna avtalsversion.'}
  }
  for (const field of ['starts_at','ends_at'] as const) {
    const value = patch[field]
    if (typeof value === 'string' && (!/^\d{4}-\d\d-\d\d$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0,10) !== value)) {
      return {ok:false, field, message:'Ange ett giltigt kalenderdatum.'}
    }
  }
  const start = Object.hasOwn(patch,'starts_at') ? patch.starts_at : contract.starts_at?.slice(0,10)
  const end = Object.hasOwn(patch,'ends_at') ? patch.ends_at : contract.ends_at?.slice(0,10)
  if (typeof start === 'string' && typeof end === 'string' && end < start) return {ok:false, field:'ends_at', message:'Slutdatum kan inte vara före startdatum.'}
  const acknowledgeCurrentTerms = form.get('acknowledge_current_terms') === 'on'
  if (commercialChange) {
    const blocker = unsignedRevisionBlocker(contract)
    if (blocker) return {ok:false, message:blocker}
    if (!acknowledgeCurrentTerms) return {ok:false, field:'acknowledge_current_terms', message:'Bekräfta att en ny kundspecifik avtalsversion med aktuella villkor ska skapas. Kunden behöver granska och signera hela den nya versionen.'}
    if (!String(form.get('override_reason') ?? '').trim()) return {ok:false, field:'override_reason', message:'Ange varför priser eller villkor ändras.'}
    if (patch.vat_rate !== undefined && patch.vat_rate !== 0.25) return {ok:false, field:'vat_rate', message:'Moms för nya konsumtionspriser måste vara 25 procent.'}
    if (patch.discount_value !== undefined && patch.discount_value !== null) return {ok:false, field:'discount_value', message:'Rabatter behöver versionshanteras genom avtalsmallen.'}
  }
  return {ok:true, editId:editId.toLowerCase(), expectedUpdatedAt, patch, acknowledgeCurrentTerms, commercialChange}
}
