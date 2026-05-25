import Link from 'next/link'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireAdminPageAccess } from '@/lib/admin/guards'
import { MASTERDATA_PERMISSIONS } from '@/lib/admin/masterdataPermissions'
import { resolveAdminTenantReadScope } from '@/lib/tenant/adminScope'
import CustomerEdielOperationsCard from '@/components/admin/customers/CustomerEdielOperationsCard'
import {
 getCustomerSiteById,
 getMeteringPointById,
 listCustomerInternalNotesByCustomerId,
 listCustomerSitesByCustomerId,
 listGridOwners,
 listMasterdataAuditLogsForCustomer,
 listMeteringPointsBySiteIds,
 listPriceAreas,
} from '@/lib/masterdata/db'
import {
 listContractOffers,
 listCustomerContractsByCustomerId,
} from '@/lib/customer-contracts/db'
import CustomerSiteForm from '@/components/admin/masterdata/CustomerSiteForm'
import CustomerSitesTable from '@/components/admin/masterdata/CustomerSitesTable'
import MeteringPointForm from '@/components/admin/masterdata/MeteringPointForm'
import MeteringPointsTable from '@/components/admin/masterdata/MeteringPointsTable'
import { createCustomerInternalNoteAction, registerCustomerLifecycleDecisionAction, savePowerOfAttorneyScopeAction } from './actions'
import type {
 AuditLogRow,
 CustomerInternalNoteRow,
 CustomerSiteRow,
 MeteringPointRow,
} from '@/lib/masterdata/types'
import type { OutboundRequestRow } from '@/lib/cis/types'
import type {
 PowerOfAttorneyRow,
 SupplierSwitchRequestRow,
 CustomerAuthorizationDocumentRow,
} from '@/lib/operations/types'
import type {
 CustomerAddressRow,
 CustomerContactRow,
 CustomerType,
} from '@/types/customers'
import CustomerBillingMeteringCard from '@/components/admin/customers/CustomerBillingMeteringCard'
import CustomerSwitchOperationsCard from '@/components/admin/customers/CustomerSwitchOperationsCard'
import CustomerContractsCard from '@/components/admin/customers/CustomerContractsCard'
import CustomerContactsAddressesCard from '@/components/admin/customers/CustomerContactsAddressesCard'
import CustomerProfileCard from '@/components/admin/customers/CustomerProfileCard'
import CustomerGridOwnerFileImportCard from '@/components/admin/customers/CustomerGridOwnerFileImportCard'
import CustomerContractOfferEligibilityCard from '@/components/admin/customers/CustomerContractOfferEligibilityCard'
import CustomerOperationsReadinessStrip from '@/components/admin/customers/CustomerOperationsReadinessStrip'
import CustomerAuthorizationDocumentsCard from '@/components/admin/customers/CustomerAuthorizationDocumentsCard'
import {
 listBillingUnderlaysByCustomerId,
 listGridOwnerDataRequestsByCustomerId,
 listMeteringValuesByCustomerId,
 listOutboundRequestsByCustomerId,
 listPartnerExportsByCustomerId,
} from '@/lib/cis/db'
import {
 listAuthorizationScopesByCustomerId,
 listCustomerInfoRequestsByCustomerId,
 listMeteringPermissionsByCustomerId,
} from '@/lib/onboarding/infoRequests'
import {
 listCustomerAuthorizationDocumentsByCustomerId,
 listPowersOfAttorneyByCustomerId,
 listSupplierSwitchEventsByRequestIds,
 listSupplierSwitchRequestsByCustomerId,
} from '@/lib/operations/db'
import { getSwitchLifecycle } from '@/lib/operations/controlTower'
import { getCustomerEdielDataBundle } from '@/lib/ediel/customerData'
import CustomerPortalAccessCard from '@/components/admin/customers/CustomerPortalAccessCard'
import { customerCaseStatusLabel, customerCaseTypeLabel, listCustomerCases } from '@/lib/customer-cases/db'
import type { CustomerContractRow } from '@/lib/customer-contracts/types'
import {
 listCustomerPortalAccountsByCustomerId,
 listCustomerPortalClaimsByCustomerId,
} from '@/lib/customer-portal/admin'

export const dynamic = 'force-dynamic'

type CustomerRow = {
 id: string
 company_id: string | null
 customer_type: string | null
 status: string | null
 first_name: string | null
 last_name: string | null
 full_name: string | null
 company_name: string | null
 email: string | null
 phone: string | null
 personal_number: string | null
 org_number: string | null
 customer_number: string | null
 source: string | null
 apartment_number: string | null
 created_at: string
 moved_out_at: string | null
 lifecycle_closed_at: string | null
 lifecycle_status_reason: string | null
 intake_status: string | null
 intake_missing_fields: unknown
 intake_quality_score: number | null
 intake_warnings?: unknown
}


type PowerOfAttorneyScopeRow = {
 id: string
 power_of_attorney_id: string
 scope_type: string
 site_id: string | null
 metering_point_id: string | null
 customer_contract_id: string | null
 status: string | null
 valid_from: string | null
 valid_to: string | null
 created_at: string | null
}

type CustomerPageProps = {
 params: Promise<{ id: string }>
 searchParams: Promise<{
 editSite?: string
 editMeteringPoint?: string
 tab?: string
 }>
}

type CustomerLifecycleSummary = {
 blocked: number
 queuedForOutbound: number
 awaitingDispatch: number
 awaitingResponse: number
 readyToExecute: number
 failed: number
 completed: number
 activeOpen: number
 primaryLabel: string
 primaryHref: string
 primaryDescription: string
}

function formatCustomerName(customer: CustomerRow): string {
 if (customer.full_name?.trim()) return customer.full_name.trim()

 const fullName = [customer.first_name, customer.last_name]
 .filter(Boolean)
 .join(' ')
 .trim()

 if (fullName) return fullName
 if (customer.company_name?.trim()) return customer.company_name.trim()
 return 'Kund'
}

function normalizeCustomerType(value: string | null | undefined): CustomerType {
 if (value === 'business') return 'business'
 if (value === 'association') return 'association'
 return 'private'
}

function customerTypeLabel(value: string | null | undefined): string {
 const customerType = normalizeCustomerType(value)

 if (customerType === 'business') return 'Företag'
 if (customerType === 'association') return 'Förening'
 return 'Privatkund'
}

function customerTypeDescription(customerType: CustomerType): string {
 if (customerType === 'business') {
 return 'Företagskund där företagsnamn och organisationsnummer är huvudidentitet, medan kontaktperson hanteras separat.'
 }

 if (customerType === 'association') {
 return 'Föreningskund där föreningsnamn och organisationsnummer är huvudidentitet, medan kontaktperson hanteras separat.'
 }

 return 'Privatkund där personuppgifterna är huvudidentitet för kunden.'
}

function identityPrimaryLabel(customerType: CustomerType): string {
 return customerType === 'private' ? 'Personnummer' : 'Organisationsnummer'
}

function identityPrimaryValue(
 customer: CustomerRow,
 customerType: CustomerType
): string {
 return customerType === 'private'
 ? maskSensitiveValue(customer.personal_number)
 : customer.org_number ?? '—'
}

function identitySecondaryLabel(customerType: CustomerType): string {
 if (customerType === 'private') return 'Lägenhetsnummer'
 return customerType === 'association' ? 'Föreningsnamn' : 'Företagsnamn'
}

function identitySecondaryValue(
 customer: CustomerRow,
 customerType: CustomerType
): string {
 if (customerType === 'private') {
 return customer.apartment_number ?? '—'
 }

 return customer.company_name ?? '—'
}

function primaryContactHeading(customerType: CustomerType): string {
 if (customerType === 'private') return 'Huvudkontakt'
 return 'Primär kontaktperson'
}

function activeAddressHeading(customerType: CustomerType): string {
 if (customerType === 'private') return 'Aktiv adress'
 if (customerType === 'association') return 'Primär adress för föreningen'
 return 'Primär adress för företaget'
}

function formatDateTime(value: string | null | undefined): string {
 if (!value) return '—'

 return new Intl.DateTimeFormat('sv-SE', {
 dateStyle: 'medium',
 timeStyle: 'short',
 }).format(new Date(value))
}

function maskSensitiveValue(value: string | null): string {
 if (!value) return '—'
 if (value.length <= 4) return value
 return `${'*'.repeat(Math.max(0, value.length - 4))}${value.slice(-4)}`
}

function statusTone(status: string | null): string {
 switch (status) {
 case 'active':
 return 'bg-emerald-100 text-emerald-700 '
 case 'draft':
 return 'bg-amber-100 text-amber-700 '
 case 'inactive':
 case 'closed':
 return 'bg-red-100 text-red-700 '
 default:
 return 'bg-slate-100 text-slate-700 '
 }
}

function normalizeJsonList(value: unknown): string[] {
 if (Array.isArray(value)) {
 return value.map((item) => String(item)).filter(Boolean)
 }
 if (typeof value === 'string' && value.trim()) return [value.trim()]
 return []
}

function intakeStatusLabel(value: string | null | undefined): string {
 switch (value) {
 case 'draft':
 return 'Utkast'
 case 'incomplete':
 return 'Ofullständig'
 case 'needs_completion':
 return 'Väntar på komplettering'
 case 'ready_for_contract':
 return 'Redo för avtal'
 case 'ready_for_operations':
 return 'Redo för drift'
 case 'blocked':
 return 'Blockerad'
 case 'rejected':
 return 'Avvisad/stoppad'
 default:
 return 'Ej klassad'
 }
}

function intakeStatusTone(value: string | null | undefined): string {
 switch (value) {
 case 'ready_for_contract':
 case 'ready_for_operations':
 return 'border-emerald-200 bg-emerald-50 text-emerald-800 '
 case 'needs_completion':
 case 'incomplete':
 return 'border-amber-200 bg-amber-50 text-amber-900 '
 case 'blocked':
 case 'rejected':
 return 'border-red-200 bg-red-50 text-red-800 '
 default:
 return 'border-slate-200 bg-slate-50 text-slate-700 '
 }
}

function lifecycleTone(stage: string): string {
 if (['ready_to_execute', 'completed'].includes(stage)) {
 return 'bg-emerald-100 text-emerald-700 '
 }

 if (['blocked', 'failed'].includes(stage)) {
 return 'bg-red-100 text-red-700 '
 }

 if (['awaiting_response'].includes(stage)) {
 return 'bg-emerald-100 text-emerald-700 '
 }

 return 'bg-amber-100 text-amber-700 '
}

function entityLabel(entityType: string): string {
 switch (entityType) {
 case 'customer':
 return 'Kund'
 case 'customer_site':
 return 'Anläggning'
 case 'metering_point':
 return 'Mätpunkt'
 default:
 return entityType
 }
}

function actionLabel(action: string): string {
 switch (action) {
 case 'insert':
 return 'Skapad'
 case 'update':
 return 'Uppdaterad'
 case 'delete':
 return 'Borttagen'
 case 'customer_created':
 return 'Kund skapad'
 default:
 return action
 }
}

function compactJson(value: Record<string, unknown> | null): string {
 if (!value) return '—'

 const keys = Object.keys(value)
 if (keys.length === 0) return '—'

 return keys
 .slice(0, 6)
 .map((key) => `${key}: ${String(value[key])}`)
 .join(' • ')
}


type CustomerWorkspaceTab =
 | 'overview'
 | 'profile'
 | 'portal-access'
 | 'grid-owner-import'
 | 'data-requests'
 | 'authorization-documents'
 | 'switch-operations'
 | 'ediel-operations'
 | 'billing-metering'
 | 'contracts'
 | 'contacts-addresses'
 | 'sites'
 | 'metering-points'
 | 'notes'
 | 'lifecycle-decisions'
 | 'cases'
 | 'audit'

const CUSTOMER_WORKSPACE_TABS: Array<{
 id: CustomerWorkspaceTab
 label: string
 description: string
 group: 'Start' | 'Drift' | 'Kunddata' | 'Historik'
}> = [
 { id: 'overview', label: 'Översikt', description: 'Status, readiness och rekommenderad nästa åtgärd.', group: 'Start' },
 { id: 'authorization-documents', label: 'Fullmakt / avtal', description: 'Dokument, signerad fullmakt och scope.', group: 'Drift' },
 { id: 'switch-operations', label: 'Leverantörsbyte', description: 'Starta och följ switchärenden.', group: 'Drift' },
 { id: 'ediel-operations', label: 'Ediel', description: 'Skapa, validera och följ Ediel-meddelanden.', group: 'Drift' },
 { id: 'billing-metering', label: 'Nätägaruppgifter', description: 'Mätvärden, billingunderlag och partnerexporter.', group: 'Drift' },
 { id: 'data-requests', label: 'Uppgiftsbegäran', description: 'Z01/Z02 och mätvärdestillstånd.', group: 'Drift' },
 { id: 'contracts', label: 'Avtal', description: 'Kundens avtal och avtalsläge.', group: 'Kunddata' },
 { id: 'profile', label: 'Profil', description: 'Kundprofil och erbjudanden.', group: 'Kunddata' },
 { id: 'contacts-addresses', label: 'Kontakter / adresser', description: 'Kontaktpersoner och faktura-/kundadresser.', group: 'Kunddata' },
 { id: 'sites', label: 'Anläggningar', description: 'Anläggningar, nätägare och elområden.', group: 'Kunddata' },
 { id: 'metering-points', label: 'Mätpunkter', description: 'Mätpunkter och mätpunktsdata.', group: 'Kunddata' },
 { id: 'portal-access', label: 'Kundportal', description: 'Portalaccess och kundkoppling.', group: 'Kunddata' },
 { id: 'grid-owner-import', label: 'Nätägarsynk', description: 'Import från nätägarsida.', group: 'Kunddata' },
 { id: 'notes', label: 'Anteckningar', description: 'Interna anteckningar.', group: 'Historik' },
 { id: 'lifecycle-decisions', label: 'Ånger / avvisning', description: 'Stoppa flöden utan att radera historik.', group: 'Historik' },
 { id: 'cases', label: 'Ärenden', description: 'Kundärenden och supportproblem.', group: 'Historik' },
 { id: 'audit', label: 'Audit', description: 'Senaste ändringar och spårbarhet.', group: 'Historik' },
]

const CUSTOMER_WORKSPACE_TAB_IDS = new Set<CustomerWorkspaceTab>(
 CUSTOMER_WORKSPACE_TABS.map((tab) => tab.id)
)

function normalizeWorkspaceTab(value: string | null | undefined): CustomerWorkspaceTab {
 if (value && CUSTOMER_WORKSPACE_TAB_IDS.has(value as CustomerWorkspaceTab)) {
 return value as CustomerWorkspaceTab
 }

 return 'overview'
}

function customerTabHref(customerId: string, tab: CustomerWorkspaceTab): string {
 return `/admin/customers/${customerId}?tab=${tab}`
}


function CustomerLookupProblem({
 title,
 description,
 lookupId,
}: {
 title: string
 description: string
 lookupId: string
}) {
 return (
 <div className="space-y-6">
 <section className="rounded-3xl border border-amber-200 bg-amber-50 p-6 shadow-sm ">
 <p className="text-sm font-semibold uppercase tracking-[0.16em] text-amber-800 ">Kundkort</p>
 <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950 ">{title}</h1>
 <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-700 ">{description}</p>
 <div className="mt-4 rounded-2xl border border-amber-200 bg-white px-4 py-3 font-mono text-xs text-slate-700 ">
 Lookup-id: {lookupId}
 </div>
 <div className="mt-5 flex flex-wrap gap-3">
 <Link href="/admin/customers" className="rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 ">
 Till kundregistret
 </Link>
 <Link href="/admin/ediel" className="rounded-2xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 ">
 Till Ediel
 </Link>
 </div>
 </section>
 </div>
 )
}

function CustomerWorkspaceTabNav({
 customerId,
 activeTab,
}: {
 customerId: string
 activeTab: CustomerWorkspaceTab
}) {
 const groups = ['Start', 'Drift', 'Kunddata', 'Historik'] as const

 return (
 <section className="sticky top-3 z-20 rounded-3xl border border-slate-200 bg-white/95 p-4 shadow-sm backdrop-blur ">
 <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
 <div>
 <h2 className="text-base font-semibold text-slate-950 ">Kundens arbetsyta</h2>
 <p className="mt-1 max-w-3xl text-sm text-slate-700 ">
 Välj arbetsflöde i knapparna nedan. Kundkortet visar bara vald del, så handläggaren slipper en lång sida som bara fortsätter nedåt.
 </p>
 </div>
 <Link href="/admin/customers" className="rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 ">
 Till kundregister
 </Link>
 </div>

 <div className="mt-4 space-y-3">
 {groups.map((group) => {
 const tabs = CUSTOMER_WORKSPACE_TABS.filter((tab) => tab.group === group)
 return (
 <div key={group} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3">
 <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-600 ">{group}</div>
 <div className="flex flex-wrap gap-2">
 {tabs.map((tab) => {
 const isActive = tab.id === activeTab
 return (
 <Link
 key={tab.id}
 href={customerTabHref(customerId, tab.id)}
 title={tab.description}
 className={`rounded-2xl border px-4 py-2.5 text-sm font-semibold transition ${
 isActive
 ? 'border-emerald-300 bg-emerald-700 text-white shadow-sm '
 : 'border-slate-300 bg-white text-slate-700 hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800 '
 }`}
 >
 {tab.label}
 </Link>
 )
 })}
 </div>
 </div>
 )
 })}
 </div>
 </section>
 )
}

async function getCustomer(
 supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
 id: string
): Promise<CustomerRow | null> {
 const { data, error } = await supabase
 .from('customers')
 .select(
 'id, company_id, customer_type, status, first_name, last_name, full_name, company_name, email, phone, personal_number, org_number, customer_number, source, apartment_number, created_at, moved_out_at, lifecycle_closed_at, lifecycle_status_reason, intake_status, intake_missing_fields, intake_quality_score, intake_warnings'
 )
 .eq('id', id)
 .maybeSingle()

 if (error) throw error
 return (data as CustomerRow | null) ?? null
}

function ActorCell({
 actorUserId,
}: {
 actorUserId: string | null
}) {
 if (!actorUserId) {
 return <span className="text-slate-700 ">System</span>
 }

 return (
 <span className="font-mono text-xs text-slate-700 ">
 {actorUserId}
 </span>
 )
}

function requestSortTime(request: SupplierSwitchRequestRow): number {
 return new Date(
 request.completed_at ??
 request.failed_at ??
 request.submitted_at ??
 request.created_at
 ).getTime()
}

function outboundSortTime(outbound: OutboundRequestRow): number {
 return new Date(
 outbound.acknowledged_at ??
 outbound.failed_at ??
 outbound.sent_at ??
 outbound.prepared_at ??
 outbound.queued_at ??
 outbound.created_at
 ).getTime()
}

function getLatestOutboundForRequest(
 requestId: string,
 outboundRequests: OutboundRequestRow[]
): OutboundRequestRow | null {
 const rows = outboundRequests
 .filter(
 (row) =>
 row.request_type === 'supplier_switch' &&
 row.source_type === 'supplier_switch_request' &&
 row.source_id === requestId
 )
 .sort((a, b) => outboundSortTime(b) - outboundSortTime(a))

 return rows[0] ?? null
}

function buildCustomerLifecycleSummary(params: {
 sites: CustomerSiteRow[]
 switchRequests: SupplierSwitchRequestRow[]
 outboundRequests: OutboundRequestRow[]
}): CustomerLifecycleSummary {
 const { sites, switchRequests, outboundRequests } = params

 const latestRequestsBySite = sites
 .map((site) => {
 const requestsForSite = switchRequests
 .filter((request) => request.site_id === site.id)
 .sort((a, b) => requestSortTime(b) - requestSortTime(a))

 return requestsForSite[0] ?? null
 })
 .filter((request): request is SupplierSwitchRequestRow => Boolean(request))

 let blocked = 0
 let queuedForOutbound = 0
 let awaitingDispatch = 0
 let awaitingResponse = 0
 let readyToExecute = 0
 let failed = 0
 let completed = 0

 for (const request of latestRequestsBySite) {
 const outbound = getLatestOutboundForRequest(request.id, outboundRequests)

 const lifecycle = getSwitchLifecycle({
 request,
 readiness: null,
 outboundRequest: outbound,
 })

 switch (lifecycle.stage) {
 case 'blocked':
 blocked += 1
 break
 case 'queued_for_outbound':
 queuedForOutbound += 1
 break
 case 'awaiting_dispatch':
 awaitingDispatch += 1
 break
 case 'awaiting_response':
 awaitingResponse += 1
 break
 case 'ready_to_execute':
 readyToExecute += 1
 break
 case 'failed':
 failed += 1
 break
 case 'completed':
 completed += 1
 break
 default:
 break
 }
 }

 const activeOpen =
 blocked +
 queuedForOutbound +
 awaitingDispatch +
 awaitingResponse +
 readyToExecute +
 failed

 if (blocked > 0) {
 return {
 blocked,
 queuedForOutbound,
 awaitingDispatch,
 awaitingResponse,
 readyToExecute,
 failed,
 completed,
 activeOpen,
 primaryLabel: 'Blockerade switchar',
 primaryHref: '/admin/operations/switches?stage=blocked',
 primaryDescription:
 'Minst en anläggning stoppas av blockerare. Börja i blockerad kö eller öppna switchsektionen på kundkortet först.',
 }
 }

 if (readyToExecute > 0) {
 return {
 blocked,
 queuedForOutbound,
 awaitingDispatch,
 awaitingResponse,
 readyToExecute,
 failed,
 completed,
 activeOpen,
 primaryLabel: 'Redo att slutföra',
 primaryHref: '/admin/operations/ready-to-execute',
 primaryDescription:
 'Det finns kvitterade switchar som kan slutföras nu. Gå direkt till ready-to-execute-kön.',
 }
 }

 if (awaitingResponse > 0) {
 return {
 blocked,
 queuedForOutbound,
 awaitingDispatch,
 awaitingResponse,
 readyToExecute,
 failed,
 completed,
 activeOpen,
 primaryLabel: 'Väntar på kvittens',
 primaryHref: '/admin/operations/switches?stage=awaiting_response',
 primaryDescription:
 'Switchen är skickad och väntar på extern återkoppling eller uppföljning.',
 }
 }

 if (awaitingDispatch > 0) {
 return {
 blocked,
 queuedForOutbound,
 awaitingDispatch,
 awaitingResponse,
 readyToExecute,
 failed,
 completed,
 activeOpen,
 primaryLabel: 'Väntar på dispatch',
 primaryHref: '/admin/operations/switches?stage=awaiting_dispatch',
 primaryDescription:
 'Outbound finns men dispatchen är inte helt igenom ännu. Kontrollera outbound-läget.',
 }
 }

 if (queuedForOutbound > 0) {
 return {
 blocked,
 queuedForOutbound,
 awaitingDispatch,
 awaitingResponse,
 readyToExecute,
 failed,
 completed,
 activeOpen,
 primaryLabel: 'Saknar outbound',
 primaryHref: '/admin/operations/switches?stage=queued_for_outbound',
 primaryDescription:
 'Det finns switchar som saknar dispatchpost och behöver köas eller felsökas.',
 }
 }

 if (failed > 0) {
 return {
 blocked,
 queuedForOutbound,
 awaitingDispatch,
 awaitingResponse,
 readyToExecute,
 failed,
 completed,
 activeOpen,
 primaryLabel: 'Failed / rejected',
 primaryHref: '/admin/operations/switches?stage=failed',
 primaryDescription:
 'Minst ett ärende har brutit flödet och behöver manuell bedömning, retry eller korrigering.',
 }
 }

 return {
 blocked,
 queuedForOutbound,
 awaitingDispatch,
 awaitingResponse,
 readyToExecute,
 failed,
 completed,
 activeOpen,
 primaryLabel: 'Inga akuta switchblockerare',
 primaryHref: '/admin/customers',
 primaryDescription:
 'Kundens switchflöde har inga tydliga akuta blockerare just nu. Fortsätt från kundkortet eller granska detaljer längre ner.',
 }
}

function getBestContactEmail(
 customer: CustomerRow,
 contacts: CustomerContactRow[]
): string | null {
 if (customer.email?.trim()) return customer.email.trim()

 const primaryWithEmail =
 contacts.find((contact) => contact.is_primary && contact.email?.trim()) ?? null
 if (primaryWithEmail?.email?.trim()) return primaryWithEmail.email.trim()

 const firstWithEmail = contacts.find((contact) => contact.email?.trim()) ?? null
 return firstWithEmail?.email?.trim() ?? null
}

function getBestContactPhone(
 customer: CustomerRow,
 contacts: CustomerContactRow[]
): string | null {
 if (customer.phone?.trim()) return customer.phone.trim()

 const primaryWithPhone =
 contacts.find((contact) => contact.is_primary && contact.phone?.trim()) ?? null
 if (primaryWithPhone?.phone?.trim()) return primaryWithPhone.phone.trim()

 const firstWithPhone = contacts.find((contact) => contact.phone?.trim()) ?? null
 return firstWithPhone?.phone?.trim() ?? null
}

function SectionAnchor({
 id,
 title,
 description,
 children,
}: {
 id: string
 title: string
 description?: string
 children: React.ReactNode
}) {
 return (
 <section id={id} className="scroll-mt-36 space-y-3">
 <div className="rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-3 ">
 <h2 className="text-base font-semibold text-slate-900 ">
 {title}
 </h2>
 {description ? (
 <p className="mt-1 text-sm text-slate-700 ">
 {description}
 </p>
 ) : null}
 </div>
 {children}
 </section>
 )
}

function QuickJumpLink({
 href,
 label,
 tone = 'default',
}: {
 href: string
 label: string
 tone?: 'default' | 'success' | 'info' | 'warning' | 'danger'
}) {
 const toneClass =
 tone === 'success'
 ? 'border-emerald-300 bg-emerald-50 text-emerald-700 '
 : tone === 'info'
 ? 'border-emerald-300 bg-emerald-50 text-emerald-700 '
 : tone === 'warning'
 ? 'border-amber-300 bg-amber-50 text-amber-700 '
 : tone === 'danger'
 ? 'border-red-300 bg-red-50 text-red-700 '
 : 'border-slate-300 bg-white text-slate-700 '

 return (
 <Link
 href={href}
 className={`inline-flex items-center rounded-2xl border px-4 py-2.5 text-sm font-semibold transition hover:opacity-90 ${toneClass}`}
 >
 {label}
 </Link>
 )
}

function StickyActionBar({
 lifecycleSummary,
 dataRequestsCount,
}: {
 lifecycleSummary: CustomerLifecycleSummary
 dataRequestsCount: number
}) {
 return (
 <div className="sticky top-3 z-20 rounded-3xl border border-slate-200 bg-white/95 p-4 shadow-sm backdrop-blur ">
 <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
 <div>
 <div className="text-sm font-semibold text-slate-900 ">
 Snabbåtgärder
 </div>
 <p className="mt-1 text-sm text-slate-700 ">
 Starta leverantörsbyte, begär uppgifter från nätägare eller hoppa direkt till Ediel utan att leta i kundkortet.
 </p>
 </div>

 <div className="flex flex-wrap gap-2">
 <QuickJumpLink href="#authorization-documents" label="Fullmakt / avtal" tone="success" />
 <QuickJumpLink href="#switch-operations" label="Nytt leverantörsbyte" tone="success" />
 <QuickJumpLink href="#billing-metering" label="Begär mätvärden" tone="warning" />
 <QuickJumpLink href="#billing-metering" label="Begär billingunderlag" tone="warning" />
 <QuickJumpLink href="#ediel-operations" label="Öppna Ediel" tone="info" />
 <QuickJumpLink href="#contracts" label="Avtal" />
 </div>
 </div>

 <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
 <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm ">
 <div className="text-slate-700 ">Primär signal</div>
 <div className="mt-1 font-semibold text-slate-950 ">
 {lifecycleSummary.primaryLabel}
 </div>
 </div>

 <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm ">
 <div className="text-slate-700 ">Öppna switchflöden</div>
 <div className="mt-1 font-semibold text-slate-950 ">
 {lifecycleSummary.activeOpen}
 </div>
 </div>

 <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm ">
 <div className="text-slate-700 ">Ready to execute</div>
 <div className="mt-1 font-semibold text-slate-950 ">
 {lifecycleSummary.readyToExecute}
 </div>
 </div>

 <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm ">
 <div className="text-slate-700 ">Nätägarbegäran</div>
 <div className="mt-1 font-semibold text-slate-950 ">
 {dataRequestsCount}
 </div>
 </div>
 </div>
 </div>
 )
}


function OnboardingDataRequestsSection({
 customerId,
 infoRequests,
 authorizationScopes,
 meteringPermissions,
}: {
 customerId: string
 infoRequests: Array<{ id: string; status: string; request_type: string; blocker_reason: string | null; created_at: string }>
 authorizationScopes: Array<{ id: string; status: string; scope_type: string; covers_grid_owner_data: boolean; covers_current_supplier_contract: boolean; covers_metering_data: boolean }>
 meteringPermissions: Array<{ id: string; status: string; case_reference: string | null; permission_reference: string | null; last_blocker: string | null; created_at: string }>
}) {
 const activeScopes = authorizationScopes.filter((scopeRow) => scopeRow.status === 'active')
 const blockedRequests = infoRequests.filter((request) => ['missing_authorization', 'route_missing', 'negative_aperak', 'blocked'].includes(request.status)).length
 const activePermissions = meteringPermissions.filter((permission) => ['approved', 'z14_received', 'active', 'partially_approved'].includes(permission.status)).length

 return (
 <section className="rounded-3xl border border-slate-200 bg-white shadow-sm ">
 <div className="border-b border-slate-200 px-6 py-5 ">
 <div className="flex flex-wrap items-start justify-between gap-3">
 <div>
 <h2 className="text-lg font-semibold text-slate-900 ">Uppgiftsbegäran och mätvärdestillstånd</h2>
 <p className="mt-1 text-sm text-slate-700 ">
 Z01/Z02, fullmaktsomfattning och Z13/Z14 är kopplade till kundens arbetsyta så att mätvärden senare kan matchas till rätt anläggning och faktureringsunderlag.
 </p>
 </div>
 <Link href={`/admin/customer-info-requests?customer=${customerId}`} className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-800 hover:bg-emerald-100 ">
 Öppna uppgiftsflöde
 </Link>
 </div>
 </div>
 <div className="grid gap-4 p-6 lg:grid-cols-3">
 <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
 <div className="text-sm text-slate-700 ">Uppgiftsbegäran</div>
 <div className="mt-1 text-2xl font-semibold text-slate-950 ">{infoRequests.length}</div>
 <div className="mt-1 text-xs text-slate-700 ">{blockedRequests} blockerade/kräver åtgärd</div>
 </div>
 <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
 <div className="text-sm text-slate-700 ">Aktiva fullmaktsscope</div>
 <div className="mt-1 text-2xl font-semibold text-slate-950 ">{activeScopes.length}</div>
 <div className="mt-1 text-xs text-slate-700 ">
 {activeScopes.some((scopeRow) => scopeRow.covers_metering_data) ? 'Mätvärden täcks' : 'Mätvärden saknar scope'}
 </div>
 </div>
 <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
 <div className="text-sm text-slate-700 ">Mätvärdestillstånd</div>
 <div className="mt-1 text-2xl font-semibold text-slate-950 ">{meteringPermissions.length}</div>
 <div className="mt-1 text-xs text-slate-700 ">{activePermissions} godkända/aktiva</div>
 </div>
 </div>
 <div className="grid gap-4 px-6 pb-6 xl:grid-cols-2">
 {[...infoRequests.slice(0, 3), ...meteringPermissions.slice(0, 3)].length === 0 ? (
 <div className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-600 xl:col-span-2">
 Inga uppgiftsbegäran eller mätvärdestillstånd finns ännu.
 </div>
 ) : (
 <>
 {infoRequests.slice(0, 3).map((request) => (
 <div key={request.id} className="rounded-2xl border border-slate-200 p-4 text-sm">
 <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusTone(request.status)}`}>{request.status}</span>
 <div className="mt-3 font-semibold text-slate-950 ">{request.request_type}</div>
 {request.blocker_reason ? <div className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-800">{request.blocker_reason}</div> : null}
 </div>
 ))}
 {meteringPermissions.slice(0, 3).map((permission) => (
 <div key={permission.id} className="rounded-2xl border border-slate-200 p-4 text-sm">
 <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusTone(permission.status)}`}>{permission.status}</span>
 <div className="mt-3 font-semibold text-slate-950 ">{permission.case_reference ?? permission.permission_reference ?? 'Z13/Z14-tillstånd'}</div>
 {permission.last_blocker ? <div className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900">{permission.last_blocker}</div> : null}
 </div>
 ))}
 </>
 )}
 </div>
 </section>
 )
}


function LifecycleDecisionSection({
 customerId,
 sites,
 meteringPoints,
 contracts,
}: {
 customerId: string
 sites: CustomerSiteRow[]
 meteringPoints: MeteringPointRow[]
 contracts: CustomerContractRow[]
}) {
 return (
 <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm ">
 <div>
 <h2 className="text-lg font-semibold text-slate-900 ">Ånger och avvisad kund</h2>
 <p className="mt-1 text-sm text-slate-700 ">
 Registrera ånger eller nekad kund på rätt nivå. Beslutet skapar ärende, audit och kan blockera fakturering utan att radera historik.
 </p>
 </div>
 <form action={registerCustomerLifecycleDecisionAction} className="mt-5 grid gap-4 md:grid-cols-2">
 <input type="hidden" name="customer_id" value={customerId} />
 <label className="grid gap-1 text-sm">
 <span className="text-slate-700 ">Beslut</span>
 <select name="decision_type" defaultValue="withdrawal" className="rounded-2xl border border-slate-300 px-4 py-3">
 <option value="withdrawal">Ånger / avbrutet av kund</option>
 <option value="rejected">Nekad / avvisad kund</option>
 </select>
 </label>
 <label className="grid gap-1 text-sm">
 <span className="text-slate-700 ">Nivå</span>
 <select name="scope_type" defaultValue="customer" className="rounded-2xl border border-slate-300 px-4 py-3">
 <option value="customer">Hela kunden</option>
 <option value="contract">Specifikt avtal</option>
 <option value="site">Specifik anläggning</option>
 <option value="metering_point">Specifik mätpunkt</option>
 </select>
 </label>
 <label className="grid gap-1 text-sm md:col-span-2">
 <span className="text-slate-700 ">Välj avtal/anläggning/mätpunkt om beslutet inte gäller hela kunden</span>
 <select name="scope_id" defaultValue="" className="rounded-2xl border border-slate-300 px-4 py-3">
 <option value="">Hela kunden eller välj relevant objekt</option>
 <optgroup label="Avtal">
 {contracts.map((contract) => (
 <option key={`contract-${contract.id}`} value={contract.id}>{contract.contract_name} · {contract.status}</option>
 ))}
 </optgroup>
 <optgroup label="Anläggningar">
 {sites.map((site) => (
 <option key={`site-${site.id}`} value={site.id}>{site.site_name} · {site.facility_id ?? 'utan anläggnings-id'}</option>
 ))}
 </optgroup>
 <optgroup label="Mätpunkter">
 {meteringPoints.map((point) => (
 <option key={`point-${point.id}`} value={point.id}>{point.meter_point_id} · {point.status}</option>
 ))}
 </optgroup>
 </select>
 </label>
 <label className="grid gap-1 text-sm md:col-span-2">
 <span className="text-slate-700 ">Orsak</span>
 <textarea name="reason" rows={3} required placeholder="Beskriv varför flödet stoppas, t.ex. ånger efter signering, bindningstid hos gammal leverantör eller fel anläggningsdata." className="rounded-2xl border border-slate-300 px-4 py-3" />
 </label>
 <label className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-900 md:col-span-2">
 <input type="checkbox" name="block_billing" defaultChecked className="mt-1" />
 <span>Blockera fakturering/export på vald nivå tills ärendet är löst.</span>
 </label>
 <button className="rounded-2xl bg-red-700 px-4 py-3 text-sm font-semibold text-white hover:bg-red-800 md:col-span-2">
 Registrera beslut och skapa ärende
 </button>
 </form>
 </section>
 )
}

function PowerOfAttorneyScopesSection({
 customerId,
 sites,
 meteringPoints,
 contracts,
 powersOfAttorney,
 scopes,
}: {
 customerId: string
 sites: CustomerSiteRow[]
 meteringPoints: MeteringPointRow[]
 contracts: CustomerContractRow[]
 powersOfAttorney: PowerOfAttorneyRow[]
 scopes: PowerOfAttorneyScopeRow[]
}) {
 return (
 <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm ">
 <div>
 <h2 className="text-lg font-semibold text-slate-900 ">Fullmaktens omfattning</h2>
 <p className="mt-1 text-sm text-slate-700 ">
 Koppla en signerad fullmakt till kund, anläggning, mätpunkt eller avtal så leverantörsbyte och uppgiftsbegäran kan valideras per objekt.
 </p>
 </div>
 {scopes.length > 0 ? (
 <div className="mt-5 grid gap-3 md:grid-cols-2">
 {scopes.map((scope) => {
 const site = sites.find((row) => row.id === scope.site_id)
 const point = meteringPoints.find((row) => row.id === scope.metering_point_id)
 const contract = contracts.find((row) => row.id === scope.customer_contract_id)
 return (
 <div key={scope.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
 <div className="font-semibold text-slate-950">{scope.scope_type}</div>
 <div className="mt-1">Fullmakt: {scope.power_of_attorney_id}</div>
 <div>Anläggning: {site?.site_name ?? scope.site_id ?? '—'}</div>
 <div>Mätpunkt: {point?.meter_point_id ?? scope.metering_point_id ?? '—'}</div>
 <div>Avtal: {contract?.contract_name ?? scope.customer_contract_id ?? '—'}</div>
 <div>Status: {scope.status ?? 'active'} · giltig {scope.valid_from ?? '—'} – {scope.valid_to ?? '—'}</div>
 </div>
 )
 })}
 </div>
 ) : (
 <div className="mt-5 rounded-2xl border border-dashed border-slate-300 p-4 text-sm text-slate-700">Inga detaljerade fullmaktsscope är sparade ännu.</div>
 )}
 <form action={savePowerOfAttorneyScopeAction} className="mt-5 grid gap-4 md:grid-cols-2">
 <input type="hidden" name="customer_id" value={customerId} />
 <label className="grid gap-1 text-sm">
 <span className="text-slate-700 ">Fullmakt</span>
 <select name="power_of_attorney_id" required className="rounded-2xl border border-slate-300 px-4 py-3">
 <option value="">Välj fullmakt</option>
 {powersOfAttorney.map((power) => (
 <option key={power.id} value={power.id}>{power.reference ?? power.id} · {power.status}</option>
 ))}
 </select>
 </label>
 <label className="grid gap-1 text-sm">
 <span className="text-slate-700 ">Scope-typ</span>
 <select name="scope_type" defaultValue="site" className="rounded-2xl border border-slate-300 px-4 py-3">
 <option value="customer">Kund</option>
 <option value="site">Anläggning</option>
 <option value="metering_point">Mätpunkt</option>
 <option value="contract">Avtal</option>
 </select>
 </label>
 <label className="grid gap-1 text-sm">
 <span className="text-slate-700 ">Anläggning</span>
 <select name="site_id" defaultValue="" className="rounded-2xl border border-slate-300 px-4 py-3">
 <option value="">Ingen/alla</option>
 {sites.map((site) => <option key={site.id} value={site.id}>{site.site_name}</option>)}
 </select>
 </label>
 <label className="grid gap-1 text-sm">
 <span className="text-slate-700 ">Mätpunkt</span>
 <select name="metering_point_id" defaultValue="" className="rounded-2xl border border-slate-300 px-4 py-3">
 <option value="">Ingen/alla</option>
 {meteringPoints.map((point) => <option key={point.id} value={point.id}>{point.meter_point_id}</option>)}
 </select>
 </label>
 <label className="grid gap-1 text-sm">
 <span className="text-slate-700 ">Avtal</span>
 <select name="contract_id" defaultValue="" className="rounded-2xl border border-slate-300 px-4 py-3">
 <option value="">Inget specifikt avtal</option>
 {contracts.map((contract) => <option key={contract.id} value={contract.id}>{contract.contract_name}</option>)}
 </select>
 </label>
 <div className="grid gap-4 md:grid-cols-2">
 <label className="grid gap-1 text-sm"><span className="text-slate-700 ">Giltig från</span><input name="valid_from" type="date" className="rounded-2xl border border-slate-300 px-4 py-3" /></label>
 <label className="grid gap-1 text-sm"><span className="text-slate-700 ">Giltig till</span><input name="valid_to" type="date" className="rounded-2xl border border-slate-300 px-4 py-3" /></label>
 </div>
 <button className="rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-800 md:col-span-2">
 Spara fullmaktsscope
 </button>
 </form>
 </section>
 )
}

function CustomerCasesSection({
 customerId,
 cases,
}: {
 customerId: string
 cases: Array<{
 id: string
 company_id: string
 title: string
 case_type: string
 status: string
 created_at: string
 withdrawal_deadline_at: string | null
 withdrawal_scenario: string | null
 cancellation_status: string | null
 cancellation_ediel_message_id: string | null
 billing_blocked: boolean
 break_fee_flagged: boolean
 next_action: string | null
 }>
}) {
 const activeCases = cases.filter((item) => !['resolved', 'closed', 'cancelled'].includes(item.status))
 const blockedBilling = cases.filter((item) => item.billing_blocked).length

 return (
 <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm ">
 <div className="flex flex-wrap items-start justify-between gap-3">
 <div>
 <h2 className="text-lg font-semibold text-slate-900 ">Kundärenden</h2>
 <p className="mt-1 text-sm text-slate-700 ">
 Ånger, nekade kunder och avbrutna flöden ligger kvar som historik. Kunden eller avtalet raderas inte; ärendet stoppar rätt flöden och blockerar fakturering när det behövs.
 </p>
 </div>
 <Link href={`/admin/customer-cases?customer=${customerId}`} className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-800 hover:bg-emerald-100 ">
 Öppna ärendeytan
 </Link>
 </div>

 <div className="mt-5 grid gap-4 md:grid-cols-3">
 <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
 <div className="text-sm text-slate-700 ">Aktiva ärenden</div>
 <div className="mt-1 text-2xl font-semibold text-slate-950 ">{activeCases.length}</div>
 </div>
 <div className="rounded-2xl border border-red-200 bg-red-50 p-4">
 <div className="text-sm text-red-800 ">Fakturering blockerad</div>
 <div className="mt-1 text-2xl font-semibold text-red-950 ">{blockedBilling}</div>
 </div>
 <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
 <div className="text-sm text-slate-700 ">Totalt historik</div>
 <div className="mt-1 text-2xl font-semibold text-slate-950 ">{cases.length}</div>
 </div>
 </div>

 {cases.length === 0 ? (
 <div className="mt-5 rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-700 ">
 Inga ärenden finns på kunden ännu. Skapa ärende när kunden ångrar sig, nekas, har fel uppgifter eller när onboarding behöver stoppas utan att historiken tas bort.
 </div>
 ) : (
 <div className="mt-5 grid gap-3">
 {cases.slice(0, 6).map((item) => (
 <article key={item.id} className="rounded-2xl border border-slate-200 p-4">
 <div className="flex flex-wrap items-start justify-between gap-3">
 <div>
 <div className="font-semibold text-slate-950 ">{item.title}</div>
 <div className="mt-1 text-xs text-slate-700 ">{customerCaseTypeLabel(item.case_type)} · {formatDateTime(item.created_at)}</div>
 </div>
 <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusTone(item.status)}`}>
 {customerCaseStatusLabel(item.status)}
 </span>
 </div>
 <div className="mt-3 grid gap-2 text-sm text-slate-700 md:grid-cols-3">
 <div>Ångerfrist: {formatDateTime(item.withdrawal_deadline_at)}</div>
 <div>Annullering: {item.cancellation_status ?? '—'}</div>
 <div>{item.billing_blocked ? 'Fakturering blockerad' : 'Ingen faktureringsblockerare'}</div>
 </div>
 {item.next_action ? <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-700 ">{item.next_action}</div> : null}
 {item.cancellation_ediel_message_id ? (
 <Link href={`/admin/ediel/messages/${item.cancellation_ediel_message_id}`} className="mt-3 inline-flex text-sm font-semibold text-emerald-800 hover:underline">
 Öppna annulleringsutkast
 </Link>
 ) : null}
 </article>
 ))}
 </div>
 )}
 </section>
 )
}

function NotesSection({
 customerId,
 notes,
}: {
 customerId: string
 notes: CustomerInternalNoteRow[]
}) {
 return (
 <section className="grid gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
 <form
 action={createCustomerInternalNoteAction}
 className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm "
 >
 <div className="mb-5">
 <h2 className="text-lg font-semibold text-slate-900 ">
 Intern anteckning
 </h2>
 <p className="mt-1 text-sm text-slate-700 ">
 Logga support- och driftinformation som inte hör hemma i kundens avtal eller adressfält.
 </p>
 </div>

 <input type="hidden" name="customer_id" value={customerId} />

 <label className="grid gap-2">
 <span className="text-sm font-medium text-slate-700 ">
 Anteckning
 </span>
 <textarea
 name="body"
 rows={8}
 className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 "
 placeholder="Skriv intern notering för support, drift eller handläggning..."
 />
 </label>

 <div className="mt-6 flex justify-end">
 <button className="inline-flex items-center rounded-2xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 ">
 Spara anteckning
 </button>
 </div>
 </form>

 <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm ">
 <div className="border-b border-slate-200 px-6 py-4 ">
 <h2 className="text-lg font-semibold text-slate-900 ">
 Intern historik
 </h2>
 <p className="mt-1 text-sm text-slate-700 ">
 {notes.length} anteckningar kopplade till kunden.
 </p>
 </div>

 {notes.length === 0 ? (
 <div className="p-10 text-center text-sm text-slate-700 ">
 Inga interna anteckningar ännu.
 </div>
 ) : (
 <div className="divide-y divide-slate-200 ">
 {notes.map((note) => (
 <article key={note.id} className="p-6">
 <div className="flex flex-wrap items-center justify-between gap-3">
 <div className="text-sm font-medium text-slate-900 ">
 Intern notering
 </div>
 <div className="text-xs text-slate-700 ">
 Skapad {formatDateTime(note.created_at)}
 </div>
 </div>

 <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700 ">
 {note.body}
 </p>

 <div className="mt-4 flex flex-wrap gap-3 text-xs text-slate-700 ">
 <span>Skapad av: {note.created_by ?? 'System'}</span>
 <span>Uppdaterad: {formatDateTime(note.updated_at)}</span>
 </div>
 </article>
 ))}
 </div>
 )}
 </div>
 </section>
 )
}

function AuditSection({
 auditLogs,
 sites,
 meteringPoints,
}: {
 auditLogs: AuditLogRow[]
 sites: CustomerSiteRow[]
 meteringPoints: MeteringPointRow[]
}) {
 const siteNameById = new Map(sites.map((site) => [site.id, site.site_name]))
 const meteringPointNameById = new Map(
 meteringPoints.map((point) => [point.id, point.meter_point_id])
 )

 return (
 <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm ">
 <div className="border-b border-slate-200 px-6 py-5 ">
 <h2 className="text-lg font-semibold text-slate-900 ">
 Senaste ändringar
 </h2>
 <p className="mt-1 text-sm text-slate-700 ">
 Visar senaste audit-händelser för kund, anläggningar och mätpunkter.
 </p>
 </div>

 {auditLogs.length === 0 ? (
 <div className="p-10 text-center text-sm text-slate-700 ">
 Inga audit-händelser hittades ännu.
 </div>
 ) : (
 <div className="overflow-x-auto">
 <table className="min-w-full text-sm">
 <thead className="bg-slate-50 ">
 <tr className="border-b border-slate-200 text-left ">
 <th className="px-6 py-4 font-semibold text-slate-700 ">
 Tid
 </th>
 <th className="px-6 py-4 font-semibold text-slate-700 ">
 Objekt
 </th>
 <th className="px-6 py-4 font-semibold text-slate-700 ">
 Händelse
 </th>
 <th className="px-6 py-4 font-semibold text-slate-700 ">
 Användare
 </th>
 <th className="px-6 py-4 font-semibold text-slate-700 ">
 Detalj
 </th>
 </tr>
 </thead>
 <tbody>
 {auditLogs.map((log) => {
 const title =
 log.entity_type === 'customer_site'
 ? siteNameById.get(log.entity_id) ?? log.entity_id
 : log.entity_type === 'metering_point'
 ? meteringPointNameById.get(log.entity_id) ?? log.entity_id
 : log.entity_id

 return (
 <tr key={log.id} className="align-top">
 <td className="px-6 py-4 text-slate-700 ">
 {formatDateTime(log.created_at)}
 </td>
 <td className="px-6 py-4">
 <div className="font-medium text-slate-900 ">
 {entityLabel(log.entity_type)}
 </div>
 <div className="mt-1 text-xs text-slate-700 ">
 {title}
 </div>
 </td>
 <td className="px-6 py-4 text-slate-700 ">
 {actionLabel(log.action)}
 </td>
 <td className="px-6 py-4">
 <ActorCell actorUserId={log.actor_user_id} />
 </td>
 <td className="px-6 py-4 text-slate-700 ">
 <div>{compactJson(log.new_values)}</div>
 </td>
 </tr>
 )
 })}
 </tbody>
 </table>
 </div>
 )}
 </section>
 )
}

export default async function CustomerAdminDetailPage({
 params,
 searchParams,
}: CustomerPageProps) {
 const access = await requireAdminPageAccess({ anyOf: ['customers.read', MASTERDATA_PERMISSIONS.READ] })

 const { id } = await params
 const resolvedSearchParams = await searchParams
 const editSiteId = resolvedSearchParams.editSite ?? null
 const editMeteringPointId = resolvedSearchParams.editMeteringPoint ?? null
 const activeTab: CustomerWorkspaceTab = editSiteId
 ? 'sites'
 : editMeteringPointId
 ? 'metering-points'
 : normalizeWorkspaceTab(resolvedSearchParams.tab)

 const supabase = await createSupabaseServerClient()
 const tenantScope = await resolveAdminTenantReadScope(access)

 if (!tenantScope.isPlatformAdmin && !tenantScope.companyId) {
 return (
 <CustomerLookupProblem
 title="Bolagskoppling saknas"
 description="Kontot saknar aktiv bolagskoppling. Kundkort kan bara öppnas när användaren har ett aktivt bolag eller platform-behörighet."
 lookupId={id}
 />
 )
 }

 const customer = await getCustomer(supabase, id)

 if (!customer) {
 return (
 <CustomerLookupProblem
 title="Kunden finns inte i kundregistret"
 description="Det här id:t finns inte som canonical kund i public.customers. Om raden fortfarande syns i kundlistan kommer den från gammal cache, annan miljö eller Ediel-testdata som inte ska öppnas som riktigt kundkort."
 lookupId={id}
 />
 )
 }

 if (!customer.company_id) {
 return (
 <CustomerLookupProblem
 title="Kunden saknar tenant-koppling"
 description="Den här raden saknar company_id och är därför inte ett giltigt SaaS-kundkort. Arkivera eller koppla raden via kontrollerad backfill innan den används."
 lookupId={id}
 />
 )
 }

 if (customer.status === 'archived') {
 return (
 <CustomerLookupProblem
 title="Kunden är arkiverad"
 description="Den här kunden har arkiverats och visas därför inte i det aktiva kundregistret."
 lookupId={id}
 />
 )
 }

 if (customer.source === 'ediel_portal_test') {
 return (
 <CustomerLookupProblem
 title="Ediel-testkund visas inte som vanlig kund"
 description="Den här raden är skapad från Edielportalens testdata. Testkunder ska hanteras från Ediel/testflödet och ska inte ligga kvar i det vanliga kundregistret."
 lookupId={id}
 />
 )
 }

 if (!tenantScope.isPlatformAdmin && customer.company_id !== tenantScope.companyId) {
 return (
 <CustomerLookupProblem
 title="Kunden tillhör ett annat bolag"
 description="Tenant-isoleringen blockerar kundkortet eftersom kunden inte tillhör ditt aktiva bolag."
 lookupId={id}
 />
 )
 }

 const customerCompanyId = tenantScope.isPlatformAdmin ? customer.company_id : tenantScope.companyId

 const [
 gridOwners,
 priceAreas,
 sites,
 notes,
 dataRequests,
 meteringValues,
 billingUnderlays,
 partnerExports,
 outboundRequests,
 switchRequests,
 contactsResponse,
 addressesResponse,
 contractOffers,
 customerContracts,
 powersOfAttorney,
 authorizationDocuments,
 customerInfoRequests,
 authorizationScopes,
 meteringPermissions,
 customerCases,
 ] = await Promise.all([
 listGridOwners(supabase),
 listPriceAreas(supabase),
 listCustomerSitesByCustomerId(supabase, id, { companyId: customerCompanyId }),
 listCustomerInternalNotesByCustomerId(id, { companyId: customerCompanyId }),
 listGridOwnerDataRequestsByCustomerId(id, { companyId: customerCompanyId, limit: 50 }),
 listMeteringValuesByCustomerId(id, { companyId: customerCompanyId, limit: 100 }),
 listBillingUnderlaysByCustomerId(id, { companyId: customerCompanyId, limit: 100 }),
 listPartnerExportsByCustomerId(id, { companyId: customerCompanyId, limit: 50 }),
 listOutboundRequestsByCustomerId(id, { companyId: customerCompanyId, limit: 50 }),
 listSupplierSwitchRequestsByCustomerId(supabase, id, { companyId: customerCompanyId, limit: 50 }),
 supabase
 .from('customer_contacts')
 .select('*')
 .eq('customer_id', id)
 .eq('company_id', customerCompanyId)
 .order('is_primary', { ascending: false })
 .order('created_at', { ascending: false }),
 supabase
 .from('customer_addresses')
 .select('*')
 .eq('customer_id', id)
 .eq('company_id', customerCompanyId)
 .order('is_active', { ascending: false })
 .order('created_at', { ascending: false }),
 listContractOffers({ activeOnly: true, companyId: customerCompanyId }),
 listCustomerContractsByCustomerId(id, { companyId: customerCompanyId }),
 listPowersOfAttorneyByCustomerId(supabase, id, { companyId: customerCompanyId, limit: 50 }),
 listCustomerAuthorizationDocumentsByCustomerId(supabase, id, { companyId: customerCompanyId, limit: 50 }),
 customerCompanyId ? listCustomerInfoRequestsByCustomerId({ companyId: customerCompanyId, customerId: id }) : [],
 customerCompanyId ? listAuthorizationScopesByCustomerId({ companyId: customerCompanyId, customerId: id }) : [],
 customerCompanyId ? listMeteringPermissionsByCustomerId({ companyId: customerCompanyId, customerId: id }) : [],
 customerCompanyId ? listCustomerCases({ companyId: customerCompanyId, customerId: id, limit: 20 }) : [],
 ])

 if (contactsResponse.error) throw contactsResponse.error
 if (addressesResponse.error) throw addressesResponse.error

 const contacts = (contactsResponse.data ?? []) as CustomerContactRow[]
 const addresses = (addressesResponse.data ?? []) as CustomerAddressRow[]
 const poaRows = powersOfAttorney as PowerOfAttorneyRow[]
 const documentRows = authorizationDocuments as CustomerAuthorizationDocumentRow[]
 const { data: powerScopeRows, error: powerScopeError } = await supabase
 .from('power_of_attorney_scopes')
 .select('*')
 .eq('customer_id', id)
 .eq('company_id', customerCompanyId)
 .order('created_at', { ascending: false })
 if (powerScopeError && !['42P01', '42703', 'PGRST205'].includes(String((powerScopeError as { code?: string }).code ?? ''))) throw powerScopeError
 const poaScopeRows = (powerScopeRows ?? []) as PowerOfAttorneyScopeRow[]

 const [meteringPoints, switchEvents, edielData, portalAccounts, portalClaims] = await Promise.all([
 listMeteringPointsBySiteIds(
 supabase,
 sites.map((site) => site.id),
 { companyId: customerCompanyId }
 ),
 listSupplierSwitchEventsByRequestIds(
 supabase,
 switchRequests.map((request) => request.id),
 { companyId: customerCompanyId, limit: 100 }
 ),
 getCustomerEdielDataBundle({
 supabase,
 customerId: id,
 companyId: customerCompanyId,
 gridOwners,
 }),
 listCustomerPortalAccountsByCustomerId(id, { companyId: customerCompanyId, limit: 20 }),
 listCustomerPortalClaimsByCustomerId(id, { companyId: customerCompanyId, limit: 20 }),
 ])

 const selectedSite = editSiteId
 ? await getCustomerSiteById(supabase, editSiteId, { companyId: customerCompanyId })
 : null

 const selectedMeteringPoint = editMeteringPointId
 ? await getMeteringPointById(supabase, editMeteringPointId, { companyId: customerCompanyId })
 : null

 const safeSelectedSite =
 selectedSite && selectedSite.customer_id === id ? selectedSite : null

 const siteIds = new Set(sites.map((site) => site.id))
 const safeSelectedMeteringPoint =
 selectedMeteringPoint && siteIds.has(selectedMeteringPoint.site_id)
 ? selectedMeteringPoint
 : null

 const auditLogs = await listMasterdataAuditLogsForCustomer({
 customerId: id,
 siteIds: sites.map((site) => site.id),
 meteringPointIds: meteringPoints.map((point) => point.id),
 limit: 30,
 })

 const customerName = formatCustomerName(customer)
 const activeSites = sites.filter((site) => site.status === 'active').length
 const activeMeteringPoints = meteringPoints.filter(
 (point) => point.status === 'active'
 ).length

 const lifecycleSummary = buildCustomerLifecycleSummary({
 sites,
 switchRequests,
 outboundRequests,
 })

 const hasReadyEdielRoute = edielData.recommendationRoutes.some((route) => {
 const hasReceiver = Boolean(
 route.profile?.receiver_ediel_id?.trim() || route.grid_owner_ediel_id?.trim()
 )

 return Boolean(
 route.is_active &&
 route.profile?.is_enabled &&
 route.profile?.sender_ediel_id?.trim() &&
 route.profile?.mailbox?.trim() &&
 hasReceiver
 )
 })

 const hasUsablePowerOfAttorney = poaRows.some(
 (row) =>
 row.scope === 'supplier_switch' &&
 row.status === 'signed' &&
 Boolean(row.document_path?.trim())
 )

 const hasSwitchData = sites.some((site) => {
 const siteMeteringPoints = meteringPoints.filter((point) => point.site_id === site.id)
 const candidateMeteringPoint =
 siteMeteringPoints.find((point) => point.status === 'active') ??
 siteMeteringPoints.find((point) => point.status === 'pending_validation') ??
 siteMeteringPoints[0] ??
 null

 return Boolean(
 candidateMeteringPoint?.meter_point_id?.trim() &&
 (candidateMeteringPoint?.grid_owner_id ?? site.grid_owner_id) &&
 (candidateMeteringPoint?.price_area_code ?? site.price_area_code) &&
 site.current_supplier_name?.trim() &&
 site.move_in_date
 )
 })

 const readinessItems = [
 {
 label: 'Avtal',
 ok: customerContracts.length > 0,
 detail:
 customerContracts.length > 0
 ? `${customerContracts.length} registrerade`
 : 'Saknar kundavtal',
 },
 {
 label: 'Fullmakt',
 ok: hasUsablePowerOfAttorney,
 detail: hasUsablePowerOfAttorney
 ? 'Signerad fullmakt med dokument finns'
 : 'Saknar signerad fullmakt med fil',
 },
 {
 label: 'Anläggning',
 ok: sites.length > 0,
 detail: sites.length > 0 ? `${sites.length} st` : 'Ingen anläggning',
 },
 {
 label: 'Mätpunkt',
 ok: meteringPoints.length > 0,
 detail:
 meteringPoints.length > 0
 ? `${meteringPoints.length} st`
 : 'Ingen mätpunkt',
 },
 {
 label: 'Switch-data',
 ok: hasSwitchData,
 detail: hasSwitchData
 ? 'Minst en anläggning har masterdata för switch'
 : 'Nuvarande leverantör, nätägare, mätpunkt eller datum saknas',
 },
 {
 label: 'Switch',
 ok: switchRequests.length > 0,
 detail:
 switchRequests.length > 0
 ? `${switchRequests.length} ärenden`
 : 'Inget switchärende',
 },
 {
 label: 'Ediel-route',
 ok: hasReadyEdielRoute,
 detail: hasReadyEdielRoute ? 'Minst en route redo' : 'Route/profile blockerad',
 },
 {
 label: 'Outbound',
 ok: outboundRequests.some((row) => row.channel_type !== 'unresolved'),
 detail:
 outboundRequests.length > 0
 ? `${outboundRequests.length} poster`
 : 'Ingen outbound ännu',
 },
 ]

 const primaryContact =
 contacts.find((contact) => contact.is_primary) ?? contacts[0] ?? null
 const activeAddress =
 addresses.find((address) => address.is_active) ?? addresses[0] ?? null

 const displayEmail = getBestContactEmail(customer, contacts)
 const displayPhone = getBestContactPhone(customer, contacts)
 const normalizedCustomerType = normalizeCustomerType(customer.customer_type)
 const customerTypeUiLabel = customerTypeLabel(customer.customer_type)
 const primaryIdentityLabel = identityPrimaryLabel(normalizedCustomerType)
 const primaryIdentityValue = identityPrimaryValue(
 customer,
 normalizedCustomerType
 )
 const secondaryIdentityLabel = identitySecondaryLabel(normalizedCustomerType)
 const secondaryIdentityValue = identitySecondaryValue(
 customer,
 normalizedCustomerType
 )

 return (
 <div className="space-y-6">
 <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm ">
 <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
 <div>
 <p className="text-sm font-medium text-slate-700 ">
 Kundkort
 </p>
 <div className="mt-1 flex flex-wrap items-center gap-3">
 <h1 className="text-2xl font-semibold tracking-tight text-slate-950 ">
 {customerName}
 </h1>
 <span
 className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${statusTone(
 customer.status
 )}`}
 >
 {customer.status ?? 'okänd'}
 </span>
 </div>

 <div className="mt-3 flex flex-wrap gap-2 text-sm text-slate-700 ">
 <span className="rounded-full bg-slate-100 px-3 py-1 ">
 {displayEmail ?? 'Ingen e-post'}
 </span>
 <span className="rounded-full bg-slate-100 px-3 py-1 ">
 {displayPhone ?? 'Ingen telefon'}
 </span>
 <span className="rounded-full bg-slate-100 px-3 py-1 ">
 {customerTypeUiLabel}
 </span>
 <span className="rounded-full bg-slate-100 px-3 py-1 ">
 Kundnummer: {customer.customer_number ?? '—'}
 </span>
 </div>

 <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 ">
 {customerTypeDescription(normalizedCustomerType)}
 </div>

 <div className="mt-4 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm ">
 <div className="flex flex-wrap items-center justify-between gap-3">
 <div>
 <div className="text-sm font-semibold text-slate-900 ">Kundintag och datakvalitet</div>
 <p className="mt-1 text-sm text-slate-700 ">Visar om kunden är redo för avtal, drift och fakturering utan att handläggaren behöver leta efter saknade uppgifter.</p>
 </div>
 <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${intakeStatusTone(customer.intake_status)}`}>
 {intakeStatusLabel(customer.intake_status)} · {customer.intake_quality_score ?? 0}%
 </span>
 </div>
 {normalizeJsonList(customer.intake_missing_fields).length > 0 ? (
 <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 ">
 <div className="font-semibold">Saknade uppgifter</div>
 <p className="mt-1">{normalizeJsonList(customer.intake_missing_fields).join(', ')}</p>
 </div>
 ) : null}
 {normalizeJsonList(customer.intake_warnings).length > 0 ? (
 <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 ">
 <div className="font-semibold">Varningar att kontrollera</div>
 <p className="mt-1">{normalizeJsonList(customer.intake_warnings).join(' ')}</p>
 </div>
 ) : null}
 </div>

 <div className="mt-4 grid gap-3 text-sm text-slate-700 sm:grid-cols-3">
 <div className="rounded-2xl bg-slate-50 px-4 py-3 ">
 <div className="text-xs uppercase tracking-[0.14em] text-slate-700 ">
 {primaryIdentityLabel}
 </div>
 <div className="mt-1 font-medium text-slate-900 ">
 {primaryIdentityValue}
 </div>
 </div>

 <div className="rounded-2xl bg-slate-50 px-4 py-3 ">
 <div className="text-xs uppercase tracking-[0.14em] text-slate-700 ">
 {secondaryIdentityLabel}
 </div>
 <div className="mt-1 font-medium text-slate-900 ">
 {secondaryIdentityValue}
 </div>
 </div>

 <div className="rounded-2xl bg-slate-50 px-4 py-3 ">
 <div className="text-xs uppercase tracking-[0.14em] text-slate-700 ">
 Skapad
 </div>
 <div className="mt-1 font-medium text-slate-900 ">
 {formatDateTime(customer.created_at)}
 </div>
 </div>
 </div>

 <div className="mt-4 grid gap-3 lg:grid-cols-2">
 <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 ">
 <div className="text-xs uppercase tracking-[0.14em] text-slate-700 ">
 {primaryContactHeading(normalizedCustomerType)}
 </div>
 <div className="mt-2 font-medium text-slate-900 ">
 {primaryContact?.name ??
 (normalizedCustomerType === 'private'
 ? customerName
 : 'Ingen primär kontaktperson')}
 </div>
 <div className="mt-2 space-y-1 text-sm text-slate-700 ">
 <div>E-post: {primaryContact?.email ?? displayEmail ?? '—'}</div>
 <div>Telefon: {primaryContact?.phone ?? displayPhone ?? '—'}</div>
 <div>Typ: {primaryContact?.type ?? '—'}</div>
 <div>Titel: {primaryContact?.title ?? '—'}</div>
 </div>
 </div>

 <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 ">
 <div className="text-xs uppercase tracking-[0.14em] text-slate-700 ">
 {activeAddressHeading(normalizedCustomerType)}
 </div>
 <div className="mt-2 font-medium text-slate-900 ">
 {activeAddress?.street_1 ?? 'Ingen aktiv adress'}
 </div>
 <div className="mt-2 space-y-1 text-sm text-slate-700 ">
 <div>
 {activeAddress
 ? `${activeAddress.postal_code ?? '—'} ${activeAddress.city ?? ''}`
 : '—'}
 </div>
 <div>Typ: {activeAddress?.type ?? '—'}</div>
 <div>Land: {activeAddress?.country ?? '—'}</div>
 </div>
 </div>
 </div>
 </div>

 <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
 <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm ">
 <div className="text-slate-700 ">Anläggningar</div>
 <div className="mt-1 text-xl font-semibold text-slate-950 ">
 {sites.length}
 </div>
 <div className="mt-1 text-xs text-slate-700 ">
 {activeSites} aktiva
 </div>
 </div>

 <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm ">
 <div className="text-slate-700 ">Mätpunkter</div>
 <div className="mt-1 text-xl font-semibold text-slate-950 ">
 {meteringPoints.length}
 </div>
 <div className="mt-1 text-xs text-slate-700 ">
 {activeMeteringPoints} aktiva
 </div>
 </div>

 <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm ">
 <div className="text-slate-700 ">Nätägar-requests</div>
 <div className="mt-1 text-xl font-semibold text-slate-950 ">
 {dataRequests.length}
 </div>
 <div className="mt-1 text-xs text-slate-700 ">
 billing + metering
 </div>
 </div>

 <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm ">
 <div className="text-slate-700 ">Partnerexporter</div>
 <div className="mt-1 text-xl font-semibold text-slate-950 ">
 {partnerExports.length}
 </div>
 <div className="mt-1 text-xs text-slate-700 ">
 queued / sent / ack
 </div>
 </div>
 </div>
 </div>

 </section>

 <CustomerWorkspaceTabNav customerId={id} activeTab={activeTab} />

 {activeTab === 'overview' ? (
 <SectionAnchor
 id="overview"
 title="Översikt"
 description="Samlad status för kundens operativa läge och rekommenderad nästa åtgärd."
 >
 <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
 <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm ">
 <div className="flex flex-wrap items-center gap-3">
 <div className="text-sm font-semibold text-slate-900 ">
 Operations summary
 </div>
 <span
 className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${lifecycleTone(
 lifecycleSummary.primaryLabel === 'Blockerade switchar'
 ? 'blocked'
 : lifecycleSummary.primaryLabel === 'Redo att slutföra'
 ? 'ready_to_execute'
 : lifecycleSummary.primaryLabel === 'Väntar på kvittens'
 ? 'awaiting_response'
 : lifecycleSummary.primaryLabel === 'Failed / rejected'
 ? 'failed'
 : lifecycleSummary.primaryLabel === 'Inga akuta switchblockerare'
 ? 'completed'
 : 'queued_for_outbound'
 )}`}
 >
 {lifecycleSummary.primaryLabel}
 </span>
 </div>

 <p className="mt-3 text-sm text-slate-700 ">
 {lifecycleSummary.primaryDescription}
 </p>

 <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
 <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm ">
 <div className="text-slate-700 ">Aktiva öppna</div>
 <div className="mt-1 text-xl font-semibold text-slate-950 ">
 {lifecycleSummary.activeOpen}
 </div>
 </div>
 <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm ">
 <div className="text-slate-700 ">Ready to execute</div>
 <div className="mt-1 text-xl font-semibold text-slate-950 ">
 {lifecycleSummary.readyToExecute}
 </div>
 </div>
 <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm ">
 <div className="text-slate-700 ">Väntar svar</div>
 <div className="mt-1 text-xl font-semibold text-slate-950 ">
 {lifecycleSummary.awaitingResponse}
 </div>
 </div>
 <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm ">
 <div className="text-slate-700 ">Blockerade</div>
 <div className="mt-1 text-xl font-semibold text-slate-950 ">
 {lifecycleSummary.blocked}
 </div>
 </div>
 </div>

 <div className="mt-5 flex flex-wrap gap-3">
 <Link
 href={lifecycleSummary.primaryHref}
 className="rounded-2xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 "
 >
 Öppna rekommenderad arbetsyta
 </Link>
 <Link href={customerTabHref(id, 'switch-operations')} className="rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100 ">
 Leverantörsbyte
 </Link>
 <Link href={customerTabHref(id, 'billing-metering')} className="rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100 ">
 Nätägaruppgifter
 </Link>
 <Link href={customerTabHref(id, 'ediel-operations')} className="rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100 ">
 Ediel
 </Link>
 </div>
 </div>

 <div className="space-y-6">
 <CustomerOperationsReadinessStrip items={readinessItems} />

 <div className="grid gap-3 sm:grid-cols-2">
 <Link href="/admin/operations/switches?stage=queued_for_outbound" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:bg-slate-50 ">
 <div className="text-sm text-slate-700 ">Saknar outbound</div>
 <div className="mt-1 text-2xl font-semibold text-slate-950 ">{lifecycleSummary.queuedForOutbound}</div>
 </Link>
 <Link href="/admin/operations/switches?stage=awaiting_dispatch" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:bg-slate-50 ">
 <div className="text-sm text-slate-700 ">Väntar dispatch</div>
 <div className="mt-1 text-2xl font-semibold text-slate-950 ">{lifecycleSummary.awaitingDispatch}</div>
 </Link>
 <Link href="/admin/operations/switches?stage=failed" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:bg-slate-50 ">
 <div className="text-sm text-slate-700 ">Failed / rejected</div>
 <div className="mt-1 text-2xl font-semibold text-slate-950 ">{lifecycleSummary.failed}</div>
 </Link>
 <Link href="/admin/operations/ready-to-execute" className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4 shadow-sm transition hover:bg-emerald-50 ">
 <div className="text-sm text-slate-700 ">Completed / ready view</div>
 <div className="mt-1 text-2xl font-semibold text-slate-950 ">{lifecycleSummary.completed + lifecycleSummary.readyToExecute}</div>
 </Link>
 </div>
 </div>
 </div>
 </SectionAnchor>
 ) : null}

 {activeTab === 'profile' ? (
 <SectionAnchor id="profile" title="Profil och erbjudanden" description="Kundens profil, status och kvalificerade avtalsmöjligheter.">
 <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
 <CustomerProfileCard customer={customer} />
 <CustomerContractOfferEligibilityCard customerType={normalizedCustomerType} offers={contractOffers} />
 </section>
 </SectionAnchor>
 ) : null}

 {activeTab === 'portal-access' ? (
 <SectionAnchor id="portal-access" title="Kundportal" description="Koppling mellan kundens login på gridex.se och rätt kundkort. Kräver matchning på personnummer, e-post, namn och anläggnings-ID.">
 <CustomerPortalAccessCard customerId={id} accounts={portalAccounts} claims={portalClaims} />
 </SectionAnchor>
 ) : null}

 {activeTab === 'grid-owner-import' ? (
 <SectionAnchor id="grid-owner-import" title="Nätägarsynk" description="Importera eller synka underlag från nätägarsidan för kunden.">
 <CustomerGridOwnerFileImportCard customerId={id} />
 </SectionAnchor>
 ) : null}

 {activeTab === 'data-requests' ? (
 <SectionAnchor id="data-requests" title="Uppgiftsbegäran och mätvärdestillstånd" description="Z01/Z02, fullmaktsomfattning och Z13/Z14 kopplat direkt till kunden.">
 <OnboardingDataRequestsSection customerId={id} infoRequests={customerInfoRequests} authorizationScopes={authorizationScopes} meteringPermissions={meteringPermissions} />
 </SectionAnchor>
 ) : null}

 {activeTab === 'authorization-documents' ? (
 <SectionAnchor id="authorization-documents" title="Fullmakt och komplett avtal" description="Ladda upp dokument på kundkortet och skapa request-paket mot nätägare och nuvarande leverantör.">
 <CustomerAuthorizationDocumentsCard customerId={id} sites={sites} meteringPoints={meteringPoints} documents={documentRows} powersOfAttorney={poaRows} />
 <div className="mt-6">
 <PowerOfAttorneyScopesSection customerId={id} sites={sites} meteringPoints={meteringPoints} contracts={customerContracts as CustomerContractRow[]} powersOfAttorney={poaRows} scopes={poaScopeRows} />
 </div>
 </SectionAnchor>
 ) : null}

 {activeTab === 'switch-operations' ? (
 <SectionAnchor id="switch-operations" title="Leverantörsbyte" description="Här startar du nytt leverantörsbyte och följer kundens switchflöde.">
 <CustomerSwitchOperationsCard customerId={id} sites={sites} meteringPoints={meteringPoints} switchRequests={switchRequests} switchEvents={switchEvents} outboundRequests={outboundRequests} edielMessages={edielData.edielMessages} edielRecommendationRoutes={edielData.recommendationRoutes} />
 </SectionAnchor>
 ) : null}

 {activeTab === 'ediel-operations' ? (
 <SectionAnchor id="ediel-operations" title="Ediel" description="Skapa, validera och följ Ediel-flödet för kundens switchar och nätägarrelaterade meddelanden.">
 <CustomerEdielOperationsCard customerId={id} sites={sites} meteringPoints={meteringPoints} gridOwners={gridOwners} switchRequests={switchRequests} dataRequests={dataRequests} communicationRoutes={edielData.communicationRoutes} routeProfiles={edielData.routeProfiles} edielMessages={edielData.edielMessages} recommendationRoutes={edielData.recommendationRoutes} />
 </SectionAnchor>
 ) : null}

 {activeTab === 'billing-metering' ? (
 <SectionAnchor id="billing-metering" title="Nätägaruppgifter" description="Här begär du mätvärden, billingunderlag och övrigt underlag från nätägaren.">
 <CustomerBillingMeteringCard customerId={id} sites={sites} meteringPoints={meteringPoints} gridOwners={gridOwners} dataRequests={dataRequests} meteringValues={meteringValues} billingUnderlays={billingUnderlays} partnerExports={partnerExports} outboundRequests={outboundRequests} />
 </SectionAnchor>
 ) : null}

 {activeTab === 'contracts' ? (
 <SectionAnchor id="contracts" title="Avtal" description="Visa, hantera och uppdatera kundens avtal.">
 <CustomerContractsCard customerId={id} />
 </SectionAnchor>
 ) : null}

 {activeTab === 'contacts-addresses' ? (
 <SectionAnchor id="contacts-addresses" title="Kontakter och adresser" description="Primära kontaktpersoner, adresser och kundens kontaktstruktur.">
 <CustomerContactsAddressesCard customerId={id} customerType={normalizedCustomerType} contacts={contacts} addresses={addresses} />
 </SectionAnchor>
 ) : null}

 {activeTab === 'sites' ? (
 <SectionAnchor id="sites" title="Anläggningar" description="Skapa eller redigera kundens anläggningar.">
 <section className="grid gap-6 xl:grid-cols-[460px_minmax(0,1fr)]">
 <CustomerSiteForm customerId={id} gridOwners={gridOwners} priceAreas={priceAreas} site={safeSelectedSite} cancelHref={`/admin/customers/${id}?tab=sites`} />
 <CustomerSitesTable customerId={id} sites={sites} gridOwners={gridOwners} meteringPoints={meteringPoints} selectedSiteId={safeSelectedSite?.id ?? null} />
 </section>
 </SectionAnchor>
 ) : null}

 {activeTab === 'metering-points' ? (
 <SectionAnchor id="metering-points" title="Mätpunkter" description="Skapa eller redigera kundens mätpunkter.">
 <section className="grid gap-6 xl:grid-cols-[460px_minmax(0,1fr)]">
 <MeteringPointForm customerId={id} sites={sites} gridOwners={gridOwners} priceAreas={priceAreas} meteringPoint={safeSelectedMeteringPoint} cancelHref={`/admin/customers/${id}?tab=metering-points`} />
 <MeteringPointsTable customerId={id} meteringPoints={meteringPoints} sites={sites} gridOwners={gridOwners} selectedMeteringPointId={safeSelectedMeteringPoint?.id ?? null} />
 </section>
 </SectionAnchor>
 ) : null}

 {activeTab === 'notes' ? (
 <SectionAnchor id="notes" title="Anteckningar" description="Intern support- och driftlogg för kunden.">
 <NotesSection customerId={id} notes={notes} />
 </SectionAnchor>
 ) : null}

 {activeTab === 'lifecycle-decisions' ? (
 <SectionAnchor id="lifecycle-decisions" title="Ånger och avvisning" description="Stoppa leverantörsbyte och fakturering på kund-, avtals-, anläggnings- eller mätpunktsnivå.">
 <LifecycleDecisionSection customerId={id} sites={sites} meteringPoints={meteringPoints} contracts={customerContracts as CustomerContractRow[]} />
 </SectionAnchor>
 ) : null}

 {activeTab === 'cases' ? (
 <SectionAnchor id="cases" title="Ärenden" description="Ånger, nekade kunder och manuell uppföljning kopplas till kundens drift- och avtalsarbete.">
 <CustomerCasesSection customerId={id} cases={customerCases} />
 </SectionAnchor>
 ) : null}

 {activeTab === 'audit' ? (
 <SectionAnchor id="audit" title="Audit" description="Senaste ändringar i kund, anläggningar och mätpunkter.">
 <AuditSection auditLogs={auditLogs} sites={sites} meteringPoints={meteringPoints} />
 </SectionAnchor>
 ) : null}

 </div>
 )
}