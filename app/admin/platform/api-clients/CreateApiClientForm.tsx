'use client'

import Link from 'next/link'
import { useActionState, useState } from 'react'
import {
  createIntegrationApiClientAction,
  type CreateApiClientState,
} from './actions'
import { INTEGRATION_API_PERMISSION_GROUPS, recommendedPermissionGroups } from '@/lib/integrations/apiClientScopes'
import { WEBSITE_INTEGRATION_BASE_URL, WEBSITE_INTEGRATION_OPENAPI_URL } from '@/lib/integrations/websiteIntegrationContract'

type CompanyOption = {
  id: string
  name: string
  status: string | null
}

const INITIAL_STATE: CreateApiClientState = {
  ok: false,
  message: '',
}

const DEFAULT_PERMISSION_GROUPS = new Set(recommendedPermissionGroups())

function remediationForMessage(companyId: string, message: string) {
  const normalized = message.toLowerCase()

  if (/avtal|contract/.test(normalized)) {
    return { href: '/admin/contracts', label: 'Gå till avtal' }
  }
  if (/villkor|integritet|ångerrätt|fullmakt|jurid|legal|prisvillkor/.test(normalized)) {
    return { href: '/admin/platform/legal-readiness', label: 'Gå till juridik' }
  }
  if (/anläggning|facility|mailbox/.test(normalized)) {
    return { href: '/admin/facility-requests', label: 'Gå till anläggningsflöde' }
  }
  if (/databas|schema/.test(normalized)) {
    return { href: '/admin/platform/security', label: 'Gå till plattformsstatus' }
  }
  if (/api|origin|scope|mina sidor|portal|webhook|readiness|provision/.test(normalized)) {
    return {
      href: companyId
        ? `/admin/platform/api-clients?companyId=${encodeURIComponent(companyId)}#tenant-go-live`
        : '#tenant-go-live',
      label: 'Öppna go-live',
    }
  }
  if (/e-post|mail|automation|cron|tenant|bolag/.test(normalized) && companyId) {
    return { href: `/admin/companies/${companyId}`, label: 'Öppna bolaget' }
  }

  return companyId
    ? { href: `/admin/companies/${companyId}`, label: 'Öppna bolaget' }
    : { href: '#tenant-go-live', label: 'Kontrollera inställningarna' }
}

export default function CreateApiClientForm({
  companies,
  defaultCompanyId = '',
}: {
  companies: CompanyOption[]
  defaultCompanyId?: string
}) {
  const [state, formAction, pending] = useActionState(createIntegrationApiClientAction, INITIAL_STATE)
  const [companyId, setCompanyId] = useState(defaultCompanyId)

  return (
    <div id="tenant-go-live" className="scroll-mt-6 rounded-[32px] border border-emerald-100 bg-white p-6 shadow-sm shadow-emerald-950/5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Go-live</p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">Sätt bolaget live</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Normalvägen är enkel: välj bolag, ange Mina sidor och bolagets webbdomäner och tryck på en knapp. OPS återanvänder rätt klient när det är säkert, kör hela readiness-kontrollen och öppnar trafik först när alla blockerare är borta.
        </p>
      </div>

      {state.message ? (
        <div className={`mt-5 rounded-2xl border p-4 text-sm ${state.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-red-200 bg-red-50 text-red-800'}`}>
          <p className="font-semibold">{state.message}</p>
          {state.readinessBlockers?.length ? (
            <div className="mt-4 rounded-2xl border border-red-200 bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-red-800">Det här blockerar live</p>
              <div className="mt-3 grid gap-2">
                {state.readinessBlockers.map((blocker: string) => {
                  const remediation = remediationForMessage(companyId, blocker)
                  return (
                    <div key={blocker} className="flex flex-col gap-2 rounded-xl border border-red-100 bg-red-50/40 p-3 sm:flex-row sm:items-center sm:justify-between">
                      <span className="text-xs leading-5 text-red-900">{blocker}</span>
                      <Link href={remediation.href} className="shrink-0 text-xs font-semibold text-red-800 underline underline-offset-2">
                        {remediation.label} →
                      </Link>
                    </div>
                  )
                })}
              </div>
              <p className="mt-3 text-xs leading-5 text-slate-600">Åtgärda blockerarna och kör sedan samma <strong>Sätt bolaget live</strong>-knapp igen. Ingen separat aktivering behövs.</p>
            </div>
          ) : null}
          {state.readinessWarnings?.length ? (
            <details className="mt-4 rounded-2xl border border-amber-200 bg-white p-4">
              <summary className="cursor-pointer text-xs font-semibold uppercase tracking-[0.16em] text-amber-800">Visa varningar ({state.readinessWarnings.length})</summary>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5 text-amber-800">
                {state.readinessWarnings.map((warning: string) => <li key={warning}>{warning}</li>)}
              </ul>
            </details>
          ) : null}
          {state.token ? (
            <div className="mt-4 rounded-2xl border border-emerald-200 bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-800">Token · visas bara en gång</p>
              <code className="mt-2 block break-all rounded-xl bg-slate-950 p-3 text-xs text-emerald-100">{state.token}</code>
              <p className="mt-3 text-xs leading-5 text-slate-600">
                Lägg den som <strong>GRIDEX_API_KEY</strong>. Använd <strong>Authorization: Bearer &lt;GRIDEX_API_KEY&gt;</strong> mot <strong>{WEBSITE_INTEGRATION_BASE_URL}</strong>. OpenAPI finns på <strong>{WEBSITE_INTEGRATION_OPENAPI_URL}</strong>.
              </p>
            </div>
          ) : null}
        </div>
      ) : null}

      <form action={formAction} className="mt-6 grid gap-5">
        <label className="grid gap-2">
          <span className="text-sm font-semibold text-slate-800">Bolag</span>
          <select
            name="companyId"
            required
            value={companyId}
            onChange={(event) => setCompanyId(event.target.value)}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900"
          >
            <option value="">Välj bolag</option>
            {companies.map((company) => (
              <option key={company.id} value={company.id}>{company.name}{company.status ? ` (${company.status})` : ''}</option>
            ))}
          </select>
        </label>

        <label className="grid gap-2">
          <span className="text-sm font-semibold text-slate-800">Mina sidor URL</span>
          <input
            name="customerPortalUrl"
            type="url"
            required
            placeholder="https://tenant.example/mina-sidor"
            className="rounded-2xl border border-slate-200 px-4 py-3 text-sm"
          />
          <span className="text-xs text-slate-500">Bolagets publika HTTPS-adress dit kunden ska komma efter teckning och i kundkommunikation.</span>
        </label>

        <label className="grid gap-2">
          <span className="text-sm font-semibold text-slate-800">Webbdomäner</span>
          <textarea
            name="allowedOrigins"
            rows={3}
            required
            placeholder={'https://tenant.example\nhttps://www.tenant.example'}
            className="rounded-2xl border border-slate-200 px-4 py-3 text-sm"
          />
          <span className="text-xs text-slate-500">Minst en HTTPS-origin krävs för en tenanthemsida. En per rad.</span>
        </label>

        <input type="hidden" name="frontendApp" value="Tenantens hemsida" />
        <input type="hidden" name="intendedUse" value="gridex_customer_portal" />

        <details className="rounded-3xl border border-slate-200 bg-slate-50/60 p-4">
          <summary className="cursor-pointer text-sm font-semibold text-slate-800">Avancerat · normalt behöver du inte ändra detta</summary>
          <div className="mt-5 grid gap-5">
            <div className="grid gap-5 lg:grid-cols-2">
              <label className="grid gap-2">
                <span className="text-sm font-semibold text-slate-800">Klientnamn</span>
                <input name="name" defaultValue="Hemsida · Mina sidor" required className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm" />
              </label>

              <label className="grid gap-2">
                <span className="text-sm font-semibold text-slate-800">Rate limit/minut</span>
                <input name="rateLimitPerMinute" type="number" min="1" max="5000" defaultValue="120" className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm" />
              </label>
            </div>

            <fieldset className="rounded-3xl border border-slate-200 bg-white p-4">
              <legend className="px-2 text-sm font-semibold text-slate-800">Behörigheter</legend>
              <p className="mt-1 text-xs leading-5 text-slate-600">Standardpaketet är förvalt. Ändra bara vid ett medvetet integrationsbehov.</p>
              <div className="mt-3 grid gap-3">
                {INTEGRATION_API_PERMISSION_GROUPS.map((group) => (
                  <label key={group.groupKey} className="flex gap-3 rounded-2xl border border-slate-100 bg-slate-50 p-3">
                    <input
                      type="checkbox"
                      name="permissionGroups"
                      value={group.groupKey}
                      defaultChecked={DEFAULT_PERMISSION_GROUPS.has(group.groupKey)}
                      className="mt-1"
                    />
                    <span>
                      <span className="block text-sm font-semibold text-slate-900">{group.label}</span>
                      <span className="block text-xs leading-5 text-slate-600">{group.description}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <label className="grid gap-2">
              <span className="text-sm font-semibold text-slate-800">Tillåtna IP-adresser</span>
              <textarea name="allowedIps" rows={3} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm" />
              <span className="text-xs text-slate-500">Valfritt. Använd bara om webbplatsen har stabil outbound-IP.</span>
            </label>

            <fieldset className="rounded-3xl border border-slate-200 bg-white p-4">
              <legend className="px-2 text-sm font-semibold text-slate-800">Webhook</legend>
              <div className="mt-2 grid gap-5">
                <label className="grid gap-2">
                  <span className="text-sm font-semibold text-slate-800">Webhook URL</span>
                  <input
                    name="webhookUrl"
                    type="url"
                    placeholder="https://example.se/api/gridex/webhook"
                    className="rounded-2xl border border-slate-200 px-4 py-3 text-sm"
                  />
                </label>

                <label className="grid gap-2">
                  <span className="text-sm font-semibold text-slate-800">Events</span>
                  <textarea
                    name="webhookEventTypes"
                    rows={5}
                    defaultValue={'customer.created\ncustomer.updated\ncustomer_number.assigned\ncontract.application_received\ncontract.confirmation_sent\ncontract.cooling_off_sent\ninvoice.created\ninvoice.sent\ninvoice.disputed\nmetering_values.updated'}
                    className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-mono"
                  />
                </label>

                <label className="grid gap-2">
                  <span className="text-sm font-semibold text-slate-800">Signing secret reference</span>
                  <input name="webhookSigningSecretRef" placeholder="GRIDEX_WEBSITE" className="rounded-2xl border border-slate-200 px-4 py-3 text-sm" />
                </label>
              </div>
            </fieldset>

            <div className="grid gap-5 lg:grid-cols-2">
              <label className="grid gap-2">
                <span className="text-sm font-semibold text-slate-800">Giltig till</span>
                <input name="expiresAt" type="date" className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm" />
              </label>

              <label className="grid gap-2">
                <span className="text-sm font-semibold text-slate-800">Intern anteckning</span>
                <input name="notes" placeholder="Ex. används av tenantens Mina sidor" className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm" />
              </label>
            </div>
          </div>
        </details>

        <button disabled={pending} className="rounded-2xl bg-emerald-700 px-5 py-3.5 text-sm font-semibold text-white shadow-sm shadow-emerald-700/20 hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60">
          {pending ? 'Verifierar och sätter live…' : 'Sätt bolaget live'}
        </button>
        <p className="text-center text-xs leading-5 text-slate-500">Knappen provisionerar eller revaliderar, kör smoke/readiness och öppnar trafik endast när allt är godkänt.</p>
      </form>
    </div>
  )
}
