// Go-live of a new supplier in the real grid area ALS (Alingsås), as Gridex staff do it: actor registry, BRP,
// verified grid owner with its certificate and subaddress, Ediel routes, website integration. Shared by the
// reality scenarios that need a live supplier (A website switch, F invoices). Synthetic data only.
import { supabaseService } from '@/lib/supabase/service'
import { configurePlatformMailbox, configureTenant, literal, sql, type LiveTenant } from '../live-chain-fixture'
import { approveTenantRouteProfiles, ensureProductionWhiteLabelColumnParity, goLiveOnWebsite, publishReceiverCertificateTrust, simulateEdielCertifiedGoLive } from './tenantWebsite'
import { checkGridOwners, chooseTenantBrp, createProductionRoutesFromWizard, confirmSafeBlankSubaddresses, importActorRegistry, materializeTenantRoutes, searchGridOwnerCertificate, operatorSession, sanitizedActorRegistry, verifyActorForCustomerFlow } from './operatorConsole'
import { prepareMarketData, startGridOwner, type GridOwnerSim } from './world'
import { configureProductionMailboxAsOperator } from './productionMailbox'

// A real SE3 grid area imported from Svenska kraftnät (ALS, Alingsås); the grid owner itself is simulated.
export const GRID_AREA = 'ALS'
/** Alingsås Energi Elnät AB in Ediel's actor registry (Netowner). */
export const GRID_OWNER_EDIEL_ID = '16700'
export const GRID_OWNER_NAME = 'Alingsås Energi Elnät AB'

export type LiveAlsSupplier = { tenant: LiveTenant; staff: Awaited<ReturnType<typeof operatorSession>>; gridOwner: GridOwnerSim; apiKey: string
  imported: { actionStatus: number; page: string }; verification: Awaited<ReturnType<typeof verifyActorForCustomerFlow>>
  provisioned: Awaited<ReturnType<typeof goLiveOnWebsite>> }

export async function goLiveAlsSupplier(report: Record<string, unknown>, options: {
  terms?: { bindingMonths: number; noticeMonths: number; renewalMonths: number }
  /** The BRP agreement's first day (default today). A supplier serving supply that started earlier had its BRP then. */
  brpValidFrom?: string
} = {}): Promise<LiveAlsSupplier> {
  if (configurePlatformMailbox() !== 1) throw Error('platform_mailbox_not_configured')
  // Platform go-live, as Gridex staff do it in /admin/ediel/actors: import Ediel's published actor
  // registry (real Ediel IDs and roles; e-mail rewritten to example.invalid) including the grid owner
  // registry. Onboarding then chooses the supplier's balance responsible party from that registry
  // (Bixia AB, 48800); an offer cannot be published without it.
  ensureProductionWhiteLabelColumnParity()
  await new Promise(resolve => setTimeout(resolve, 3000))
  const registry = sanitizedActorRegistry()
  let imported = { actionStatus: 0, page: '' }
  let staff: LiveAlsSupplier['staff'] | undefined
  const tenant = await configureTenant(supabaseService as never, { brp: false, terms: options.terms, beforePublish: async onboarding => {
    staff = await operatorSession(onboarding.operatorEmail, onboarding.operatorPassword)
    imported = await importActorRegistry(staff, registry.path)
    report.registryImport = imported
    report.tenantBrp = await chooseTenantBrp(staff, onboarding.companyId, 'Bixia AB', options.brpValidFrom ?? new Date().toISOString().slice(0, 10))
  } })
  if (!staff) throw Error('operator_session_missing')
  report.marketData = await prepareMarketData()
  // Then the area's real grid owner is verified for the customer flow.
  const verification = await verifyActorForCustomerFlow(staff, GRID_OWNER_NAME)
  report.gridOwnerVerification = verification
  // The grid owner's S/MIME receiver certificate from the Ediel certificate directory (Expisoft, simulated),
  // and the registry's empty PRODAT/UTILTS subaddress confirmed as safe, then the grid owner check.
  await fetch('http://127.0.0.1:3902/__sim/actor', { method: 'POST', body: JSON.stringify({ edielId: GRID_OWNER_EDIEL_ID, name: GRID_OWNER_NAME, email: registry.mailboxFor(GRID_OWNER_EDIEL_ID) }) })
  const opsGridOwnerId = sql<string>(`SELECT to_jsonb(id::text) FROM public.grid_owners WHERE ediel_id=${literal(GRID_OWNER_EDIEL_ID)} AND company_id IS NULL`)
  report.gridOwnerCertificate = await searchGridOwnerCertificate(staff, opsGridOwnerId)
  report.gridOwnerSubaddress = await confirmSafeBlankSubaddresses(staff)
  report.gridOwnerCheck = await checkGridOwners(staff)
  // The shared production mailbox the grid owner answers production files to (FINDINGS T7).
  report.productionMailbox = await configureProductionMailboxAsOperator(staff)
  // FINDINGS F36/F37: no supported path takes a new supplier live in production or publishes a receiver's
  // certificate trust. The simulation stands in for Ediel certification, first-send approval and the external
  // trust owner; everything after it is the real code. Routes are materialized after go-live, as for a supplier
  // that is already live (a route profile snapshots the send lock when it is materialized: FINDINGS F38).
  report.certifiedGoLive = simulateEdielCertifiedGoLive(tenant.companyId, tenant.adminUserId)
  report.certificateTrust = await publishReceiverCertificateTrust(tenant.companyId, GRID_OWNER_EDIEL_ID, tenant.adminUserId)
  // The go-live route wizard: the tenant's PRODAT/UTILTS routes whose receiver is the customer's grid owner.
  // It leaves the registry-materialized grid-owner routes alone (FINDINGS F41).
  report.routeWizard = await createProductionRoutesFromWizard(staff, tenant.companyId)
  // The tenant's operational Ediel routes to the grid owner, then their production approval.
  report.tenantRoutes = await materializeTenantRoutes(staff, tenant.companyId, GRID_OWNER_EDIEL_ID, 'production')
  report.routeProfileApproval = await approveTenantRouteProfiles(tenant.companyId, tenant.adminUserId)
  report.gridOwnerMapping = sql(`SELECT coalesce(jsonb_agg(jsonb_build_object('platform',pgo.name,'ops',go.name,'ediel',go.ediel_id,'verified',go.verified_for_customer_flow,'status',go.verification_status)),'[]')
    FROM public.platform_grid_owners pgo LEFT JOIN public.grid_owners go ON go.id=pgo.ops_grid_owner_id WHERE pgo.name=${literal(GRID_OWNER_NAME)}`)
  // The real grid owner of ALS, played by the simulator on its rewritten mailbox.
  const gridOwner = await startGridOwner({ edielId: GRID_OWNER_EDIEL_ID, email: registry.mailboxFor(GRID_OWNER_EDIEL_ID), pollMs: 10_000 })
  const provisioned = await goLiveOnWebsite(tenant, tenant.adminUserId)
  report.tenant = { companyId: tenant.companyId, supplier: tenant.supplierEdielId, gridOwner: tenant.issuerEdielId }
  report.websiteGoLive = { state: provisioned.state, launchReady: provisioned.launchReady, visibleContracts: provisioned.visibleContractCount,
    blockers: provisioned.readinessBlockers, warnings: provisioned.readinessWarnings }
  return { tenant, staff, gridOwner, apiKey: provisioned.credential?.token ?? '', imported, verification, provisioned }
}
