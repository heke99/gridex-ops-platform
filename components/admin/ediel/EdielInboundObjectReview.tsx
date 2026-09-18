import type { EdielInboundCaseRow } from '@/lib/ediel/inboundCases'

type RecordValue = Record<string, unknown>
const record = (value: unknown): RecordValue => value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {}
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : []
const text = (value: unknown): string => typeof value === 'string' ? value : ''

export function inboundObjectReview(item: EdielInboundCaseRow) {
  const objects = array(item.proposed_action?.objects).map(record)
  const plan = record(item.review_decision?.objectApplication)
  const locked = Boolean(item.review_decision?.objectApplication)
  const decisions = array(plan.decisions).map(record)
  return { objects, decisions, locked, completed: array(plan.receipts).length, multi: objects.length > 1 || locked }
}

/** Server-rendered explicit choices. The action reauthorizes the case company
 * and the application rechecks these identities against the original wire.
 * This display is never a source of policy, customer matching or authority.
 */
export default function EdielInboundObjectReview({ item, editable }: { item: EdielInboundCaseRow; editable: boolean }) {
  const state = inboundObjectReview(item)
  return <div className="space-y-3">
    <p className="text-sm text-slate-800">
      {state.objects.length} anläggningar. Varje anläggning får ett eget beslut och ett eget transaktionskvitto.
      {state.locked ? ` ${state.completed} av ${state.decisions.length} objekt har sparade kvitton. Besluten är låsta. Samma operatör ska återuppta körningen för att behålla transaktionsidentiteten.` : ' Granska varje kund och anläggning innan du godkänner.'}
    </p>
    {state.objects.map((object, index) => {
      const id = text(object.meteringPointId), agency = text(object.identityAgency)
      const decision = state.decisions.find(value => value.meteringPointId === id && value.identityAgency === agency)
      const registers = array(object.registers).map(record)
      const prefix = `${item.id}-object-${index}`
      const values = {
        objectMeteringPointId: id, objectIdentityAgency: agency,
        objectMode: text(decision?.mode), objectCustomerId: text(decision?.selectedCustomerId),
        objectSiteId: text(decision?.selectedSiteId), objectMeteringPointDbId: text(decision?.selectedMeteringPointId),
      }
      return <fieldset key={prefix} className="rounded-xl border border-slate-300 bg-white p-3">
        <legend className="px-1 text-sm font-semibold">Anläggning {id || 'saknas'} · {agency || 'kodlista saknas'}</legend>
        <p className="text-sm text-slate-800">{text(registers[0]?.endUserName) || 'Kundnamn saknas'} · {registers.length} register</p>
        {editable && state.locked ? Object.entries(values).map(([name,value]) => <input key={name} type="hidden" name={name} value={value} />) : null}
        {editable && !state.locked ? <>
          <input type="hidden" name="objectMeteringPointId" value={id} />
          <input type="hidden" name="objectIdentityAgency" value={agency} />
          <label htmlFor={`${prefix}-mode`} className="mt-2 block text-xs font-semibold">Beslut för denna anläggning</label>
          <select id={`${prefix}-mode`} name="objectMode" defaultValue="" required className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm">
            <option value="" disabled>Välj ett beslut</option>
            <option value="create_new_customer">Skapa separat kund med anläggning och mätpunkt</option>
            <option value="update_existing_customer">Uppdatera vald befintlig kund</option>
            <option value="link_existing_only">Koppla befintlig kund, anläggning och mätpunkt utan dataändring</option>
          </select>
          <p className="mt-2 text-xs text-slate-700">Vid enbart koppling krävs interna UUID för kund, anläggning och mätpunkt. Vid ny kund ska alla tre fälten vara tomma. Vid uppdatering krävs kundens UUID; en vald mätpunkt kräver även dess anläggning.</p>
          {([
            ['objectCustomerId','Befintlig kund (UUID)'], ['objectSiteId','Befintlig anläggning (UUID)'], ['objectMeteringPointDbId','Befintlig mätpunkt (UUID)'],
          ] as const).map(([name,label]) => <label key={name} htmlFor={`${prefix}-${name}`} className="mt-2 block text-xs font-semibold">
            {label}<input id={`${prefix}-${name}`} name={name} type="text" autoComplete="off" defaultValue="" className="mt-1 block w-full rounded-lg border border-slate-300 p-2 text-sm" />
          </label>)}
        </> : null}
        {state.locked ? <p className="mt-2 text-xs text-slate-700">Låst beslut: {text(decision?.mode) || 'Ofullständigt beslut — kräver granskning'}</p> : null}
      </fieldset>
    })}
  </div>
}
