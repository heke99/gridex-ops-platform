'use client'

import {useActionState} from 'react'
import {prepareLocalSimulationPartnerAction,issueLocalSimulationPartnerAction,revokeLocalSimulationPartnerAction,type LocalPartnerState} from './localSimulationActions'
const initial:LocalPartnerState={ok:false,message:''}
const scopes=['partner_contracts.write','partner_sites.write','partner_power_of_attorney.write','customer_profile.read','customer_sites.read','customer_contracts.read','customer_power_of_attorney.read']
const field='block w-full rounded border border-slate-300 px-3 py-2'
export default function LocalSimulationPartnerForm({companies,defaultCompanyId,requestKey}:{companies:{id:string;name:string}[];defaultCompanyId?:string;requestKey:string}) {
  const [prepared,prepare,pending]=useActionState(prepareLocalSimulationPartnerAction,initial)
  const [issued,issue,issuing]=useActionState(issueLocalSimulationPartnerAction,initial)
  const [revoked,revoke,revoking]=useActionState(revokeLocalSimulationPartnerAction,initial)
  const receipt=prepared.receipt
  return <section className="mt-8 rounded-3xl border border-amber-300 bg-amber-50 p-6" aria-labelledby="local-partner-heading">
    <h2 id="local-partner-heading" className="text-xl font-semibold">Lokal API-testmodell</h2>
    <p className="my-3 text-sm">Utfärda en tillfällig nyckel för egna syntetiska kunder, anläggningar, avtalsutkast och fullmaktsattester. Detta ger ingen kundsignatur, CPS, publicering, fakturering eller extern leverans. Bolaget förblir i sin nuvarande livscykel.</p>
    <form action={prepare} className="grid gap-3 md:grid-cols-2">
      <input type="hidden" name="idempotencyKey" value={`partner-prepare:${requestKey}`} />
      <label>Testbolag<select name="companyId" className={field} defaultValue={defaultCompanyId??''} required><option value="">Välj bolag</option>{companies.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label>Gäller till (UTC, högst en timme)<input className={field} name="expiresAt" placeholder="2026-11-13T23:30:00Z" required /></label>
      <label>Befintligt utkast till erbjudande (UUID)<input className={field} name="sourceOfferId" required /></label>
      <label>Befintlig prisversion i utkast (UUID)<input className={field} name="pricePlanVersionId" required /></label>
      <label className="md:col-span-2">Prisversionens faktiska SHA256<input className={field} name="expectedPvContentSha256" pattern="[0-9a-f]{64}" required /></label>
      <button disabled={pending||!requestKey} className="rounded bg-slate-900 px-4 py-2 text-white">{pending?'Förbereder…':'Förbered testdeklaration'}</button>
    </form>
    <p role="status" className="my-3">{prepared.message}</p>
    {receipt&&<form action={issue} key={receipt.admissionId} className="space-y-3">
      <label>Utfärdad lokal testdeklaration<textarea className={`${field} h-64 font-mono text-xs`} readOnly value={receipt.visibleDocumentText} /></label>
      <input type="hidden" name="admissionId" value={receipt.admissionId} /><input type="hidden" name="visibleDocumentText" value={receipt.visibleDocumentText} />
      <input type="hidden" name="documentSha256" value={receipt.documentSha256} /><input type="hidden" name="expiresAt" value={receipt.expiresAt} />
      <input type="hidden" name="idempotencyKey" value={`partner-issue:${requestKey}`} />
      <fieldset><legend>Minsta nödvändiga API-rättigheter</legend>{scopes.map(s=><label key={s} className="mr-4 inline-block"><input type="checkbox" name="scopes" value={s} /> {s}</label>)}</fieldset>
      <label>Tillåtna IP/CIDR (tomt innebär ingen IP-begränsning)<textarea name="allowedIps" className={field} /></label>
      <label>Tillåtna origin (tomt innebär ingen origin-begränsning)<textarea name="allowedOrigins" className={field} /></label>
      <label className="block"><input type="checkbox" name="confirmed" value="yes" required /> Jag attesterar endast den synliga lokala testmodellen; detta är ingen kundåtgärd eller extern fullmakt.</label>
      <button disabled={issuing||Boolean(issued.token)} className="rounded bg-slate-900 px-4 py-2 text-white">{issuing?'Utfärdar…':'Attestera och utfärda testnyckel'}</button>
    </form>}
    <p role="status" className="my-3">{issued.message}</p>
    {issued.token&&<label>Nyckel — spara nu<input className={`${field} font-mono`} readOnly value={issued.token} autoComplete="off" /></label>}
    <details className="mt-4"><summary>Återkalla lokal testbehörighet</summary><form action={revoke} className="grid gap-3 pt-3">
      <label>Admission-ID<input className={field} name="admissionId" defaultValue={receipt?.admissionId??''} required /></label>
      <label>Typ<select name="targetKind" className={field}><option value="admission">Hela testmodellen</option><option value="credential">En nyckel</option><option value="poa">En lokal fullmaktsattest</option></select></label>
      <label>Objektets UUID (tomt för hela modellen)<input className={field} name="targetId" /></label>
      <label>Orsak<input className={field} name="reason" required maxLength={200} /></label>
      <button disabled={revoking} className="rounded border border-slate-500 px-4 py-2">Återkalla</button><p role="status">{revoked.message}</p>
    </form></details>
  </section>
}
