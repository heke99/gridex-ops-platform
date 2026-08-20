// Extracted from page.tsx; keep public imports on the facade module.
import Link from "next/link"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { isPlatformAdminContext, requireAdminPageAccess } from "@/lib/admin/guards"
import { MASTERDATA_PERMISSIONS } from "@/lib/admin/masterdataPermissions"
import { resolveAdminTenantReadScope } from "@/lib/tenant/adminScope"
import CustomerEdielOperationsCard from "@/components/admin/customers/CustomerEdielOperationsCard"
import { getCustomerSiteById, getMeteringPointById, listCustomerInternalNotesByCustomerId, listCustomerSitesByCustomerId, listGridOwners, listMasterdataAuditLogsForCustomer, listMeteringPointsBySiteIds, listPriceAreas } from "@/lib/masterdata/db"
import { listContractOffers, listCustomerContractsByCustomerId } from "@/lib/customer-contracts/db"
import CustomerSiteForm from "@/components/admin/masterdata/CustomerSiteForm"
import CustomerSitesTable from "@/components/admin/masterdata/CustomerSitesTable"
import MeteringPointForm from "@/components/admin/masterdata/MeteringPointForm"
import MeteringPointsTable from "@/components/admin/masterdata/MeteringPointsTable"

import type { CustomerSiteRow } from "@/lib/masterdata/types"

import type { PowerOfAttorneyRow, CustomerAuthorizationDocumentRow, CustomerBlockerRow } from "@/lib/operations/types"
import type { CustomerAddressRow, CustomerContactRow } from "@/types/customers"
import CustomerBillingMeteringCard from "@/components/admin/customers/CustomerBillingMeteringCard"
import CustomerSwitchOperationsCard from "@/components/admin/customers/CustomerSwitchOperationsCard"
import CustomerContractsCard from "@/components/admin/customers/CustomerContractsCard"
import CustomerContactsAddressesCard from "@/components/admin/customers/CustomerContactsAddressesCard"
import CustomerProfileCard from "@/components/admin/customers/CustomerProfileCard"
import { buildCustomerCardWorkflow } from "@/lib/customer-operations/customerCardWorkflow"
import { buildTenantCustomerCardView } from "@/lib/customer-operations/customerCardTenantView"
import CustomerGridOwnerFileImportCard from "@/components/admin/customers/CustomerGridOwnerFileImportCard"
import CustomerContractOfferEligibilityCard from "@/components/admin/customers/CustomerContractOfferEligibilityCard"
import CustomerOperationsReadinessStrip from "@/components/admin/customers/CustomerOperationsReadinessStrip"
import CustomerPortalDataChainCard from "@/components/admin/customers/CustomerPortalDataChainCard"
import CustomerLegalReadinessCard from "@/components/admin/customers/CustomerLegalReadinessCard"
import CustomerFacilityWorkflowCard from "@/components/admin/customers/CustomerFacilityWorkflowCard"
import CustomerBusinessActionsCard from "@/components/admin/customers/CustomerBusinessActionsCard"
import CustomerAuthorizationDocumentsCard from "@/components/admin/customers/CustomerAuthorizationDocumentsCard"
import CustomerDataRequestsCard from "@/components/admin/customers/CustomerDataRequestsCard"
import { listBillingUnderlaysByCustomerId, listGridOwnerDataRequestsByCustomerId, listMeteringValuesByCustomerId, listOutboundRequestsByCustomerId, listPartnerExportsByCustomerId } from "@/lib/cis/db"
import { listCustomerInfoRequestsByCustomerId, listZ01RepairEventsByCustomerId } from "@/lib/onboarding/infoRequests"
import { resolveEdielDispatchState } from "@/lib/ediel/intent/dispatchState"
import { listManualGridOwnerRequestSummaries } from "@/lib/customer-operations/manualRequestSummary"
import { listCustomerAuthorizationDocumentsByCustomerId, listCustomerBlockersByCustomerId, listPowersOfAttorneyByCustomerId, listSupplierSwitchEventsByRequestIds, listSupplierSwitchRequestsByCustomerId } from "@/lib/operations/db"

import { getCustomerEdielDataBundle, type CustomerEdielDataBundle } from "@/lib/ediel/customerData"
import CustomerPortalAccessCard from "@/components/admin/customers/CustomerPortalAccessCard"
import type { CustomerContractRow } from "@/lib/customer-contracts/types"
import { listCustomerPortalAccountsByCustomerId, listCustomerPortalClaimsByCustomerId } from "@/lib/customer-portal/admin"
import { getCustomerAnalytics } from "@/lib/analytics/db"
import { formatMwh } from "@/lib/analytics/utils"
import { getCustomerCommunicationLogs, type CommunicationLog } from "@/lib/email/communicationLogs"
import { listBillingPartnerCustomersForCustomer, listWebsiteApplicationsForCustomer, type BillingPartnerCustomerSummary, type WebsiteApplicationAdminRow } from "@/lib/admin/websiteIntegrationOps"

import { customerStatusLabel } from "@/lib/customers/statusLabels"
import { evaluateCustomerOpsMasterReadiness, listCustomerDocuments, listCustomerLegalAcceptances, listCustomerOpsTimeline } from "@/lib/opsMaster/readiness"
import { buildAdminDataChain } from "@/lib/customer-portal/status"
import { buildCustomerCardSnapshot, buildCustomerReadinessItems } from "@/lib/customers/customerCardSnapshot"
import type { CustomerPageProps, CustomerWorkspaceTab, PowerOfAttorneyScopeRow } from './page.part-1'
import { CUSTOMER_WORKSPACE_TABS, CustomerLookupProblem, SectionAnchor, buildCustomerLifecycleSummary, canShowCustomerWorkspaceTab, customerTabHref, customerTypeLabel, formatCustomerName, getBestContactEmail, getBestContactPhone, getCustomer, identityPrimaryLabel, identityPrimaryValue, identitySecondaryLabel, identitySecondaryValue, normalizeCustomerType, normalizeWorkspaceTab, statusTone } from './page.part-1'
import { AuditSection, CustomerBlockersBanner, CustomerWebsiteTraceabilityCard, LifecycleDecisionSection, NotesSection, PowerOfAttorneyScopesSection } from './page.part-2'
import { CustomerCommunicationSection } from './page.part-3'

export async function CustomerAdminDetailPage({
  params,
  searchParams,
}: CustomerPageProps) {
  const access = await requireAdminPageAccess({
    anyOf: ["customers.read", MASTERDATA_PERMISSIONS.READ],
  });
  const isPlatformAdmin = isPlatformAdminContext(access);
  const canReadContracts = isPlatformAdmin || access.permissions.includes("contracts.read");
  const canWriteContracts = isPlatformAdmin || access.permissions.includes("contracts.write");

  const { id } = await params;
  const resolvedSearchParams = await searchParams;
  const editSiteId = resolvedSearchParams.editSite ?? null;
  const editMeteringPointId = resolvedSearchParams.editMeteringPoint ?? null;
  const requestedTab: CustomerWorkspaceTab = editSiteId
    ? "sites"
    : editMeteringPointId
      ? "metering-points"
      : normalizeWorkspaceTab(resolvedSearchParams.tab);
  const activeTab: CustomerWorkspaceTab = canShowCustomerWorkspaceTab(
    requestedTab,
    isPlatformAdmin,
    canReadContracts,
  )
    ? requestedTab
    : "overview";

  const supabase = await createSupabaseServerClient();
  const tenantScope = await resolveAdminTenantReadScope(access);

  if (!tenantScope.isPlatformAdmin && !tenantScope.companyId) {
    return (
      <CustomerLookupProblem
        title="Bolagskoppling saknas"
        description="Kontot saknar aktiv bolagskoppling. Kundkort kan bara öppnas när användaren har ett aktivt bolag eller platform-behörighet."
        lookupId={id}
      />
    );
  }

  const customer = await getCustomer(supabase, id);

  if (!customer) {
    return (
      <CustomerLookupProblem
        title="Kunden finns inte i kundregistret"
        description="Kunden hittades inte i det aktiva kundregistret. Kontrollera att du är i rätt bolag och att kunden inte har flyttats eller rensats från denna miljö."
        lookupId={id}
      />
    );
  }

  if (!customer.company_id) {
    return (
      <CustomerLookupProblem
        title="Kunden saknar bolagskoppling"
        description="Kunden saknar bolagskoppling och kan därför inte användas i kundflödet. Koppla kunden till rätt bolag eller arkivera raden innan den används."
        lookupId={id}
      />
    );
  }

  if (customer.source === "ediel_portal_test") {
    return (
      <CustomerLookupProblem
        title="Edielportalens kontrollkund visas inte som vanlig kund"
        description="Den här raden är skapad från Edielportalens kontrollflöde. Den ska hanteras från Ediel-arbetsytan och inte ligga kvar i det vanliga kundregistret."
        lookupId={id}
      />
    );
  }

  if (
    !tenantScope.isPlatformAdmin &&
    customer.company_id !== tenantScope.companyId
  ) {
    return (
      <CustomerLookupProblem
        title="Kunden tillhör ett annat bolag"
        description="Tenant-isoleringen blockerar kundkortet eftersom kunden inte tillhör ditt aktiva bolag."
        lookupId={id}
      />
    );
  }

  const customerCompanyId = tenantScope.isPlatformAdmin
    ? customer.company_id
    : tenantScope.companyId;
  // Load only the data required by the selected workspace tab. The overview
  // keeps a lightweight cross-process summary; provider-heavy diagnostics are
  // only loaded on the dedicated platform diagnostics tab.
  const needsEdielData = isPlatformAdmin && ["overview", "switch-operations", "ediel-operations", "technical-details"].includes(activeTab);
  const needsGridOwners = ["overview", "sites", "data-requests", "switch-operations", "technical-details"].includes(activeTab);
  const needsPriceAreas = isPlatformAdmin && ["sites", "metering-points", "technical-details"].includes(activeTab);
  const needsContractOffers = (isPlatformAdmin || canWriteContracts) && ["profile", "contracts", "technical-details"].includes(activeTab);
  const needsBillingMeteringData = ["overview", "billing-metering", "technical-details"].includes(activeTab);
  const needsAnalyticsData = isPlatformAdmin && activeTab === "analytics";
  const needsPortalAccessData = isPlatformAdmin && activeTab === "portal-access";
  const needsSwitchEvents = isPlatformAdmin && ["switch-operations", "technical-details"].includes(activeTab);
  const needsAuditLogs = isPlatformAdmin && ["audit", "technical-details"].includes(activeTab);
  const needsPowerScopes = isPlatformAdmin && ["authorization-documents", "legal-readiness", "technical-details"].includes(activeTab);
  const needsOpsMasterData = ["overview", "legal-readiness", "technical-details"].includes(activeTab);
  const needsCommunicationLogs = ["communication", "technical-details"].includes(activeTab) && (isPlatformAdmin || activeTab === "communication");
  const needsNotes = ["notes", "technical-details"].includes(activeTab);
  const needsGridOwnerDataRequests = ["overview", "billing-metering", "switch-operations", "data-requests", "technical-details"].includes(activeTab);
  const needsWebsiteTraceability = isPlatformAdmin && activeTab === "technical-details";
  const needsZ01RepairEvents = isPlatformAdmin && activeTab === "technical-details";
  const emptyEdielData: CustomerEdielDataBundle = {
    communicationRoutes: [],
    routeProfiles: [],
    edielMessages: [],
    recommendationRoutes: [],
  };

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
    customerBlockers,
    communicationLogs,
    websiteApplications,
    billingPartnerCustomers,
    customerLegalAcceptances,
    customerDocuments,
    customerOpsTimeline,
  ] = await Promise.all([
    needsGridOwners ? listGridOwners(supabase) : Promise.resolve([]),
    needsPriceAreas ? listPriceAreas(supabase) : Promise.resolve([]),
    listCustomerSitesByCustomerId(supabase, id, {
      companyId: customerCompanyId,
    }),
    needsNotes
      ? listCustomerInternalNotesByCustomerId(id, { companyId: customerCompanyId })
      : Promise.resolve([]),
    needsGridOwnerDataRequests
      ? listGridOwnerDataRequestsByCustomerId(id, {
          companyId: customerCompanyId,
          limit:
            needsBillingMeteringData || ["ediel-operations", "technical-details"].includes(activeTab) ? 50 : 10,
        })
      : Promise.resolve([]),
    needsBillingMeteringData
      ? listMeteringValuesByCustomerId(id, {
          companyId: customerCompanyId,
          limit: activeTab === "billing-metering" ? 100 : 20,
        })
      : Promise.resolve([]),
    needsBillingMeteringData
      ? listBillingUnderlaysByCustomerId(id, {
          companyId: customerCompanyId,
          limit: activeTab === "billing-metering" ? 100 : 20,
        })
      : Promise.resolve([]),
    needsBillingMeteringData
      ? listPartnerExportsByCustomerId(id, {
          companyId: customerCompanyId,
          limit: activeTab === "billing-metering" ? 50 : 10,
        })
      : Promise.resolve([]),
    ["overview", "billing-metering", "switch-operations", "technical-details"].includes(activeTab)
      ? listOutboundRequestsByCustomerId(id, {
          companyId: customerCompanyId,
          limit: activeTab === "overview" ? 20 : 50,
        })
      : Promise.resolve([]),
    listSupplierSwitchRequestsByCustomerId(supabase, id, {
      companyId: customerCompanyId,
      limit: activeTab === "switch-operations" ? 50 : 20,
    }),
    supabase
      .from("customer_contacts")
      .select("*")
      .eq("customer_id", id)
      .eq("company_id", customerCompanyId)
      .order("is_primary", { ascending: false })
      .order("created_at", { ascending: false }),
    supabase
      .from("customer_addresses")
      .select("*")
      .eq("customer_id", id)
      .eq("company_id", customerCompanyId)
      .order("is_active", { ascending: false })
      .order("created_at", { ascending: false }),
    needsContractOffers
      ? listContractOffers({ activeOnly: true, companyId: customerCompanyId })
      : Promise.resolve([]),
    listCustomerContractsByCustomerId(id, { companyId: customerCompanyId }),
    listPowersOfAttorneyByCustomerId(supabase, id, {
      companyId: customerCompanyId,
      limit: 50,
    }),
    listCustomerAuthorizationDocumentsByCustomerId(supabase, id, {
      companyId: customerCompanyId,
      limit: 50,
    }),
    customerCompanyId
      ? listCustomerInfoRequestsByCustomerId({
          companyId: customerCompanyId,
          customerId: id,
        })
      : Promise.resolve([]),
    listCustomerBlockersByCustomerId(supabase, id, {
      companyId: customerCompanyId,
      limit: 50,
    }),
    needsCommunicationLogs && customerCompanyId
      ? getCustomerCommunicationLogs(customerCompanyId, id)
      : Promise.resolve([]),
    needsWebsiteTraceability && customerCompanyId
      ? listWebsiteApplicationsForCustomer(customerCompanyId, id)
      : Promise.resolve([]),
    needsWebsiteTraceability && customerCompanyId
      ? listBillingPartnerCustomersForCustomer(customerCompanyId, id)
      : Promise.resolve([]),
    needsOpsMasterData && customerCompanyId
      ? listCustomerLegalAcceptances(customerCompanyId, id)
      : Promise.resolve([]),
    needsOpsMasterData && customerCompanyId
      ? listCustomerDocuments(customerCompanyId, id)
      : Promise.resolve([]),
    needsOpsMasterData && customerCompanyId
      ? listCustomerOpsTimeline(customerCompanyId, id)
      : Promise.resolve([]),
  ]);

  if (contactsResponse.error) throw contactsResponse.error;
  if (addressesResponse.error) throw addressesResponse.error;

  const contacts = (contactsResponse.data ?? []) as CustomerContactRow[];
  const addresses = (addressesResponse.data ?? []) as CustomerAddressRow[];
  const poaRows = powersOfAttorney as PowerOfAttorneyRow[];
  const z01RepairEvents = needsZ01RepairEvents && customerCompanyId
    ? await listZ01RepairEventsByCustomerId({ companyId: customerCompanyId, customerId: id })
    : [];
  const documentRows =
    authorizationDocuments as CustomerAuthorizationDocumentRow[];
  const { data: powerScopeRows, error: powerScopeError } = needsPowerScopes
    ? await supabase
        .from("power_of_attorney_scopes")
        .select("*")
        .eq("customer_id", id)
        .eq("company_id", customerCompanyId)
        .order("created_at", { ascending: false })
    : { data: [], error: null };
  if (
    powerScopeError &&
    !["42P01", "42703", "PGRST205"].includes(
      String((powerScopeError as { code?: string }).code ?? ""),
    )
  )
    throw powerScopeError;
  const poaScopeRows = (powerScopeRows ?? []) as PowerOfAttorneyScopeRow[];

  const [
    meteringPoints,
    switchEvents,
    edielData,
    portalAccounts,
    portalClaims,
  ] = await Promise.all([
    listMeteringPointsBySiteIds(
      supabase,
      sites.map((site) => site.id),
      { companyId: customerCompanyId },
    ),
    needsSwitchEvents
      ? listSupplierSwitchEventsByRequestIds(
          supabase,
          switchRequests.map((request) => request.id),
          { companyId: customerCompanyId, limit: 100 },
        )
      : Promise.resolve([]),
    needsEdielData
      ? getCustomerEdielDataBundle({
          supabase,
          customerId: id,
          companyId: customerCompanyId,
          gridOwners,
        })
      : Promise.resolve(emptyEdielData),
    needsPortalAccessData
      ? listCustomerPortalAccountsByCustomerId(id, {
          companyId: customerCompanyId,
          limit: 20,
        })
      : Promise.resolve([]),
    needsPortalAccessData
      ? listCustomerPortalClaimsByCustomerId(id, {
          companyId: customerCompanyId,
          limit: 20,
        })
      : Promise.resolve([]),
  ]);

  const selectedSite = editSiteId
    ? await getCustomerSiteById(supabase, editSiteId, {
        companyId: customerCompanyId,
      })
    : null;

  const selectedMeteringPoint = editMeteringPointId
    ? await getMeteringPointById(supabase, editMeteringPointId, {
        companyId: customerCompanyId,
      })
    : null;

  const safeSelectedSite =
    selectedSite && selectedSite.customer_id === id ? selectedSite : null;

  const siteIds = new Set(sites.map((site) => site.id));
  const safeSelectedMeteringPoint =
    selectedMeteringPoint && siteIds.has(selectedMeteringPoint.site_id)
      ? selectedMeteringPoint
      : null;

  const auditLogs = needsAuditLogs
    ? await listMasterdataAuditLogsForCustomer({
        customerId: id,
        siteIds: sites.map((site) => site.id),
        meteringPointIds: meteringPoints.map((point) => point.id),
        limit: 30,
      })
    : [];

  const analytics =
    needsAnalyticsData && customerCompanyId
      ? await getCustomerAnalytics(
          customerCompanyId,
          id,
          new Date().toISOString().slice(0, 10),
        )
      : null;

  const customerName = formatCustomerName(customer);
  const activeSites = sites.filter((site) => site.status === "active").length;
  const activeMeteringPoints = meteringPoints.filter(
    (point) => point.status === "active",
  ).length;

  const lifecycleSummary = buildCustomerLifecycleSummary({
    sites,
    switchRequests,
    outboundRequests,
  });

  const isReadyEdielRouteForGridOwner = (gridOwnerId: string) =>
    edielData.recommendationRoutes.some((route) => {
      const profile = route.profile
      const receiverEdielId = profile?.receiver_ediel_id?.trim() || route.grid_owner_ediel_id?.trim() || ''
      const gridOwnerEdielId = route.grid_owner_ediel_id?.trim() || ''
      const receiverSubaddress = profile?.receiver_message_subaddress?.trim() || profile?.receiver_sub_address?.trim() || ''
      const profileFamily = profile?.message_family?.trim().toUpperCase() || null
      const profileCode = profile?.message_code?.trim().toUpperCase() || null
      const requiresSubaddress = profile?.subaddress_required === true
      const productionProdat = profile?.environment === 'production' && (profileFamily === 'PRODAT' || !profileFamily)
      const secureTransport = profile?.transport_security_mode?.trim().toLowerCase()
      const encryptionMode = profile?.encryption_mode?.trim().toLowerCase()
      const requiresCertificate = profile?.certificate_required === true || encryptionMode === 'smime' || secureTransport === 'required_encrypted' || secureTransport === 'encrypted'
      const supportsCustomerDataOrSwitch = !profileCode || ['Z01', 'Z03'].includes(profileCode)

      // This mirrors the outbound contract guard for the customer-facing
      // readiness state. Sending performs the final certificate-validity check.
      return Boolean(
        route.grid_owner_id === gridOwnerId &&
        route.is_active &&
        profile?.is_enabled &&
        profile?.sender_ediel_id?.trim() &&
        receiverEdielId &&
        (!requiresSubaddress || receiverSubaddress) &&
        route.target_email?.trim() &&
        profile?.mailbox?.trim() &&
        (!gridOwnerEdielId || receiverEdielId === gridOwnerEdielId) &&
        (!profileFamily || profileFamily === 'PRODAT') &&
        supportsCustomerDataOrSwitch &&
        (!profile?.application_reference || profile.application_reference.trim().toUpperCase() === '23-DDQ-PRODAT') &&
        (!productionProdat || encryptionMode === 'smime') &&
        (!requiresCertificate || Boolean(profile?.receiver_certificate_id))
      )
    })


  const routeReadyBySiteId = Object.fromEntries(
    sites.map((site) => {
      const gridOwnerId =
        site.grid_owner_id ??
        meteringPoints.find((point) => point.site_id === site.id)?.grid_owner_id ??
        null;
      return [site.id, Boolean(gridOwnerId && isReadyEdielRouteForGridOwner(gridOwnerId))];
    }),
  );

  const customerGridOwnerIds = Array.from(
    new Set(
      sites
        .map((site) =>
          site.grid_owner_id ??
          meteringPoints.find((point) => point.site_id === site.id)?.grid_owner_id ??
          null,
        )
        .filter((value): value is string => Boolean(value?.trim())),
    ),
  );

  const hasReadyEdielRoute =
    customerGridOwnerIds.length > 0 &&
    customerGridOwnerIds.every(isReadyEdielRouteForGridOwner);

  const opsMasterReadiness = evaluateCustomerOpsMasterReadiness({
    customerId: id,
    customerStatus: customer.status,
    contracts: customerContracts as Array<Record<string, unknown>>,
    powersOfAttorney: poaRows as Array<Record<string, unknown>>,
    sites: sites as Array<Record<string, unknown>>,
    meteringPoints: meteringPoints as Array<Record<string, unknown>>,
    legalAcceptances: customerLegalAcceptances,
    documents: customerDocuments,
    communicationLogs: communicationLogs as Array<Record<string, unknown>>,
    hasReadyEdielRoute,
    routeReadyBySiteId,
  });

  const hasUsablePowerOfAttorney = opsMasterReadiness.hasActivePowerOfAttorney;

  const customerCardSnapshot = buildCustomerCardSnapshot({
    sites,
    meteringPoints,
    powersOfAttorney: poaRows,
    documents: documentRows,
    customerDocuments: customerDocuments as Array<Record<string, unknown>>,
    infoRequests: customerInfoRequests,
    contracts: customerContracts as CustomerContractRow[],
    legalAcceptances: customerLegalAcceptances as Array<
      Record<string, unknown>
    >,
    events: customerOpsTimeline as Array<Record<string, unknown>>,
  });
  const legalLooksAccepted = customerCardSnapshot.hasLegalAcceptance;

  // Single source of truth for outbound dispatch (intent → outbox → message).
  // Used so the overview card never claims "waiting for grid owner" unless a real
  // queued/sent state exists.
  const customerDispatchState = customerCompanyId
    ? await resolveEdielDispatchState({
        companyId: customerCompanyId,
        customerId: id,
        customerSiteId: customerCardSnapshot.primarySite?.id ?? null,
      }).catch(() => null)
    : null;

  // Tenant-safe manual grid-owner request summaries (from
  // grid_owner_information_requests) so the customer card reflects the manual
  // e-mail pipeline status, not only customer_info_requests.
  const manualRequestSummaries = customerCompanyId
    ? await listManualGridOwnerRequestSummaries({
        companyId: customerCompanyId,
        customerId: id,
        // Superadmin diagnostics: recipient resolution (real contact vs safe
        // override) is never loaded for tenant views.
        includeRecipientResolution: isPlatformAdmin && activeTab === "technical-details",
      }).catch(() => [])
    : [];

  const customerWorkflow = buildCustomerCardWorkflow({
    customerId: id,
    snapshot: customerCardSnapshot,
    sites,
    meteringPoints,
    infoRequests: customerInfoRequests,
    contracts: customerContracts as CustomerContractRow[],
    switchRequests,
    powersOfAttorney: poaRows,
    manualRequests: manualRequestSummaries,
    isPlatformAdmin,
    dispatchState: customerDispatchState,
  });
  const switchCompleted = switchRequests.some((request) => request.status === "completed");
  const switchInProgress = switchRequests.some((request) =>
    ["queued", "validated", "ready_to_send", "submitted", "waiting_response", "accepted"].includes(String(request.status ?? "")),
  );
  const billingReady = billingUnderlays.some((row) =>
    ["ready_for_invoice", "invoiced", "exported"].includes(String((row as Record<string, unknown>).invoice_readiness_status ?? (row as Record<string, unknown>).status ?? "")),
  );
  const billingInProgress = billingUnderlays.some((row) =>
    ["draft", "collecting", "validated", "ready", "price_preview_ready"].includes(String((row as Record<string, unknown>).status ?? "")),
  );
  const tenantCustomerView = buildTenantCustomerCardView({
    snapshot: customerCardSnapshot,
    workflow: customerWorkflow,
    dispatchState: customerDispatchState,
    switchCompleted,
    switchInProgress,
    deliveryActive: switchCompleted && (customerContracts as CustomerContractRow[]).some((contract) => contract.status === "active"),
    billingReady,
    billingInProgress,
  });

  const hasSwitchData = sites.some((site) => {
    const siteMeteringPoints = meteringPoints.filter(
      (point) => point.site_id === site.id,
    );
    const candidateMeteringPoint =
      siteMeteringPoints.find((point) => point.status === "active") ??
      siteMeteringPoints.find(
        (point) => point.status === "pending_validation",
      ) ??
      siteMeteringPoints[0] ??
      null;

    return Boolean(
      candidateMeteringPoint?.meter_point_id?.trim() &&
      (candidateMeteringPoint?.grid_owner_id ?? site.grid_owner_id) &&
      (candidateMeteringPoint?.price_area_code ?? site.price_area_code) &&
      site.current_supplier_name?.trim() &&
      site.move_in_date,
    );
  });

  const portalDataChain = buildAdminDataChain({
    customer: customer as unknown as Record<string, unknown>,
    contracts: customerContracts as unknown as Array<Record<string, unknown>>,
    sites: sites as unknown as Array<Record<string, unknown>>,
    meteringPoints: meteringPoints as unknown as Array<Record<string, unknown>>,
    powersOfAttorney: poaRows as unknown as Array<Record<string, unknown>>,
    legalAcceptances: customerLegalAcceptances as Array<
      Record<string, unknown>
    >,
    applications: websiteApplications as unknown as Array<
      Record<string, unknown>
    >,
  });

  const readinessItems = buildCustomerReadinessItems(customerCardSnapshot);

  const primaryContact =
    contacts.find((contact) => contact.is_primary) ?? contacts[0] ?? null;

  // Anläggningsadressen är operativ sanning för kundkortet. customer_addresses
  // är en historik-/spegelvy och får aldrig skymma en faktisk customer_site-adress.
  const addressSiteCandidates = [
    customerCardSnapshot.primarySite,
    ...sites.filter((site) => site.id !== customerCardSnapshot.primarySite?.id),
  ].filter((site): site is CustomerSiteRow => Boolean(site));
  const activeSiteAddress = addressSiteCandidates.find((site) =>
    Boolean(site.street?.trim() || site.postal_code?.trim() || site.city?.trim()),
  ) ?? null;
  const activeFacilityAddress =
    addresses.find(
      (address) => address.type === "facility" && address.is_active,
    ) ?? null;
  const activeAddress =
    activeFacilityAddress ??
    addresses.find((address) => address.is_active) ??
    addresses[0] ??
    null;
  const activeAddressDisplay = activeSiteAddress
    ? {
        street: activeSiteAddress.street?.trim() || "Anläggningsadress behöver kompletteras",
        postalCode: activeSiteAddress.postal_code?.trim() || null,
        city: activeSiteAddress.city?.trim() || null,
        country: activeSiteAddress.country?.trim() || "SE",
        type: "Anläggningsadress",
      }
    : activeAddress
      ? {
          street: activeAddress.street_1?.trim() || "Adress behöver kompletteras",
          postalCode: activeAddress.postal_code,
          city: activeAddress.city,
          country: activeAddress.country,
          type: activeAddress.type || "Adress",
        }
      : null;

  const displayEmail = getBestContactEmail(customer, contacts);
  const displayPhone = getBestContactPhone(customer, contacts);
  const normalizedCustomerType = normalizeCustomerType(customer.customer_type);
  const customerTypeUiLabel = customerTypeLabel(customer.customer_type);
  const primaryIdentityLabel = identityPrimaryLabel(normalizedCustomerType);
  const primaryIdentityValue = identityPrimaryValue(
    customer,
    normalizedCustomerType,
  );
  const secondaryIdentityLabel = identitySecondaryLabel(normalizedCustomerType);
  const secondaryIdentityValue = identitySecondaryValue(
    customer,
    normalizedCustomerType,
  );

  const openCustomerBlockers = (
    customerBlockers as CustomerBlockerRow[]
  ).filter(
    (blocker) =>
      !["resolved", "closed", "dismissed"].includes(
        String(blocker.status ?? "").toLowerCase(),
      ),
  );
  const activeCustomerContract =
    customerContracts.find((contract) =>
      ["active", "signed", "pending_signature"].includes(contract.status),
    ) ??
    customerContracts[0] ??
    null;
  const pendingCustomerInfoRequests = customerInfoRequests.filter((request) =>
    [
      "draft",
      "ready_to_send",
      "z01_prepared",
      "sent",
      "sent_to_grid_owner",
      "waiting_response",
      "waiting_for_contrl",
      "waiting_for_aperak",
      "waiting_for_z02",
      "z02_received",
      "partially_received",
    ].includes(String(request.status ?? "").toLowerCase()),
  );
  const showFoldedTechnicalPanels = isPlatformAdmin && activeTab === "ediel-operations";

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-700">Kundkort</p>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-950">
              {customerName}
            </h1>
            <span
              className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${statusTone(
                customer.status,
              )}`}
            >
              {customerStatusLabel(customer.status)}
            </span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2 text-sm text-slate-700">
            <span className="rounded-full bg-slate-100 px-3 py-1">
              Kundnummer: {customer.customer_number ?? "—"}
            </span>
            <span className="rounded-full bg-slate-100 px-3 py-1">
              {displayEmail ?? "Ingen e-post"}
            </span>
            <span className="rounded-full bg-slate-100 px-3 py-1">
              {displayPhone ?? "Ingen telefon"}
            </span>
            {activeCustomerContract ? (
              <span className="rounded-full bg-slate-100 px-3 py-1">
                {activeCustomerContract.contract_name}
              </span>
            ) : null}
          </div>
        </div>
      </section>

      {isPlatformAdmin && activeTab === "technical-details" ? (
        <CustomerBlockersBanner blockers={customerBlockers as CustomerBlockerRow[]} />
      ) : null}

      {customer.status === "archived" ? (
        <section className="rounded-3xl border border-amber-200 bg-amber-50 p-5 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-semibold text-amber-900">
                Kunden är arkiverad
              </p>
              <p className="mt-1 text-sm leading-6 text-amber-900">
                Historik, avtal, audit, kommunikation och fakturaunderlag finns
                kvar för spårbarhet. Kunden visas inte som aktiv och ska inte gå
                vidare till leverantörsbyte eller fakturering.
              </p>
            </div>
            <span className="rounded-full border border-amber-300 bg-white px-3 py-1 text-xs font-semibold text-amber-900">
              {customer.archive_reason ?? "Arkiverad"}
            </span>
          </div>
        </section>
      ) : null}

      <nav
        aria-label="Kundkortets delar"
        className="flex flex-wrap gap-2 rounded-3xl border border-slate-200 bg-white p-3 text-sm shadow-sm"
      >
        {CUSTOMER_WORKSPACE_TABS
          .filter((tab) => canShowCustomerWorkspaceTab(tab.id, isPlatformAdmin, canReadContracts))
          .map((tab) => (
            <Link
              key={tab.id}
              href={customerTabHref(id, tab.id)}
              aria-current={activeTab === tab.id ? "page" : undefined}
              className={`rounded-full border px-3 py-1.5 font-semibold transition ${
                activeTab === tab.id
                  ? "border-emerald-700 bg-emerald-700 text-white"
                  : "border-slate-200 text-slate-700 hover:bg-slate-50"
              }`}
            >
              {tab.label}
            </Link>
          ))}
      </nav>

      {activeTab === "overview" ? (
        <SectionAnchor
          id="overview"
          title="Översikt"
          description="Enkel översikt med process, status och ett tydligt nästa steg."
        >
          <CustomerBusinessActionsCard
            customerId={id}
            companyId={customerCompanyId ?? undefined}
            sites={sites}
            meteringPoints={meteringPoints}
            powersOfAttorney={poaRows}
            documents={documentRows}
            infoRequests={customerInfoRequests}
            contracts={customerContracts as CustomerContractRow[]}
            switchRequests={switchRequests}
            snapshot={customerCardSnapshot}
            isPlatformAdmin={isPlatformAdmin}
            z01RepairEvents={z01RepairEvents}
            dispatchState={customerDispatchState}
            manualRequests={manualRequestSummaries}
            billingUnderlays={billingUnderlays as Array<Record<string, unknown>>}
            isTestData={customer.is_test_data === true}
          />

        </SectionAnchor>
      ) : null}

      <span id="avtal" aria-hidden className="block scroll-mt-36" />
      {activeTab === "legal-readiness" ? (
        <SectionAnchor
          id="legal-readiness"
          title="Juridik och godkännanden"
          description="Villkor, fullmakt, avtalssnapshot, dokument och blockerare i vanliga ord."
        >
          <CustomerLegalReadinessCard
            customerId={id}
            readiness={opsMasterReadiness}
            acceptances={customerLegalAcceptances}
            documents={customerDocuments}
            timeline={customerOpsTimeline}
            snapshot={customerCardSnapshot}
            powersOfAttorney={poaRows as unknown as Array<Record<string, unknown>>}
            customerIdentity={customer.personal_number ?? customer.org_number ?? null}
          />
        </SectionAnchor>
      ) : null}

      {activeTab === "profile" ? (
        <SectionAnchor
          id="profile"
          title="Kunduppgifter"
          description="Kundens identitet, kontaktuppgifter och adresser. Avancerade livscykelverktyg ligger separat."
        >
          <section className="grid gap-6">
            <div className={isPlatformAdmin ? "grid gap-6 xl:grid-cols-2" : "grid gap-6"}>
              <CustomerProfileCard customer={customer} showLifecycleTools={isPlatformAdmin} />
              {isPlatformAdmin ? (
                <CustomerContractOfferEligibilityCard
                  customerId={id}
                  customerType={normalizedCustomerType}
                  offers={contractOffers}
                />
              ) : null}
            </div>
            <CustomerContactsAddressesCard
              customerId={id}
              customerType={normalizedCustomerType}
              contacts={contacts}
              addresses={addresses}
              sites={sites}
            />
          </section>
        </SectionAnchor>
      ) : null}

      {isPlatformAdmin && activeTab === "portal-access" ? (
        <SectionAnchor
          id="portal-access"
          title="Kundportal"
          description="Koppling mellan kundens login på gridex.se och rätt kundkort. Kräver matchning på personnummer, e-post, namn och anläggnings-ID."
        >
          <CustomerPortalAccessCard
            customerId={id}
            accounts={portalAccounts}
            claims={portalClaims}
          />
        </SectionAnchor>
      ) : null}

      {isPlatformAdmin && activeTab === "grid-owner-import" ? (
        <SectionAnchor
          id="grid-owner-import"
          title="Nätägarsynk"
          description="Importera eller synka underlag från nätägarsidan för kunden."
        >
          <CustomerGridOwnerFileImportCard customerId={id} />
        </SectionAnchor>
      ) : null}

      {isPlatformAdmin && activeTab === "data-requests" ? (
        <SectionAnchor
          id="data-requests"
          title="Uppgiftsbegäran"
          description="Begär uppgifter från nätägare eller nuvarande leverantör med enkla handläggarord. Plattformen sköter tekniken i bakgrunden."
        >
          <CustomerDataRequestsCard
            customerId={id}
            sites={sites}
            meteringPoints={meteringPoints}
            gridOwners={gridOwners}
            infoRequests={customerInfoRequests}
            powersOfAttorney={poaRows}
            documents={documentRows}
            snapshot={customerCardSnapshot}
            isPlatformAdmin={isPlatformAdmin}
          />
        </SectionAnchor>
      ) : null}

      {isPlatformAdmin && activeTab === "authorization-documents" ? (
        <SectionAnchor
          id="authorization-documents"
          title="Fullmakt och komplett avtal"
          description="Ladda upp dokument på kundkortet och skapa request-paket mot nätägare och nuvarande leverantör."
        >
          <CustomerAuthorizationDocumentsCard
            customerId={id}
            sites={sites}
            meteringPoints={meteringPoints}
            documents={documentRows}
            powersOfAttorney={poaRows}
          />
          <div className="mt-6">
            <PowerOfAttorneyScopesSection
              customerId={id}
              sites={sites}
              meteringPoints={meteringPoints}
              contracts={customerContracts as CustomerContractRow[]}
              powersOfAttorney={poaRows}
              scopes={poaScopeRows}
            />
          </div>
        </SectionAnchor>
      ) : null}

      <span id="leverantorsbyte" aria-hidden className="block scroll-mt-36" />
      {isPlatformAdmin && activeTab === "switch-operations" ? (
        <SectionAnchor
          id="switch-operations"
          title="Leverantörsbyte"
          description="Här startar du nytt leverantörsbyte och följer kundens switchflöde."
        >
          <CustomerSwitchOperationsCard
            customerId={id}
            sites={sites}
            meteringPoints={meteringPoints}
            switchRequests={switchRequests}
            switchEvents={switchEvents}
            outboundRequests={outboundRequests}
            edielMessages={edielData.edielMessages}
            edielRecommendationRoutes={edielData.recommendationRoutes}
            isPlatformAdmin={isPlatformAdmin}
            allowTenantStartSwitch={customerCardSnapshot.recommendedAction === "request_switch"}
          />
        </SectionAnchor>
      ) : null}

      {isPlatformAdmin && showFoldedTechnicalPanels ? (
        <SectionAnchor
          id="ediel-operations"
          title="Ediel"
          description="Skapa, validera och följ Ediel-flödet för kundens switchar och nätägarrelaterade meddelanden."
        >
          <CustomerEdielOperationsCard
            customerId={id}
            sites={sites}
            meteringPoints={meteringPoints}
            gridOwners={gridOwners}
            switchRequests={switchRequests}
            dataRequests={dataRequests}
            communicationRoutes={edielData.communicationRoutes}
            routeProfiles={edielData.routeProfiles}
            edielMessages={edielData.edielMessages}
            recommendationRoutes={edielData.recommendationRoutes}
            isPlatformAdmin={isPlatformAdmin}
          />
        </SectionAnchor>
      ) : null}

      <span id="fakturering" aria-hidden className="block scroll-mt-36" />
      {activeTab === "billing-metering" ? (
        <SectionAnchor
          id="billing-metering"
          title="Fakturering"
          description="Status för mätvärden, fakturaunderlag och fakturapartner."
        >
          <CustomerBillingMeteringCard
            customerId={id}
            sites={sites}
            meteringPoints={meteringPoints}
            gridOwners={gridOwners}
            dataRequests={dataRequests}
            meteringValues={meteringValues}
            billingUnderlays={billingUnderlays}
            partnerExports={partnerExports}
            outboundRequests={outboundRequests}
            isPlatformAdmin={isPlatformAdmin}
          />
        </SectionAnchor>
      ) : null}

      {isPlatformAdmin && activeTab === "analytics" ? (
        <SectionAnchor
          id="analytics"
          title="Statistik och prognos"
          description="En enkel kundvy för prognos, faktiskt utfall och saknad data."
        >
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-sm font-black text-slate-700">
                Prognos denna månad
              </p>
              <p className="mt-2 text-3xl font-black text-slate-950">
                {formatMwh(analytics?.current?.forecast_kwh ?? 0)}
              </p>
              <p className="mt-2 text-xs font-bold text-slate-500">
                Aktuell kundprognos
              </p>
            </div>
            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-sm font-black text-slate-700">
                Prognos nästa månad
              </p>
              <p className="mt-2 text-3xl font-black text-slate-950">
                {formatMwh(analytics?.next?.forecast_kwh ?? 0)}
              </p>
              <p className="mt-2 text-xs font-bold text-slate-500">
                Planerad volym
              </p>
            </div>
            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-sm font-black text-slate-700">
                Faktiskt utfall
              </p>
              <p className="mt-2 text-3xl font-black text-slate-950">
                {formatMwh(analytics?.current?.actual_kwh ?? 0)}
              </p>
              <p className="mt-2 text-xs font-bold text-slate-500">
                Inkomna mätvärden
              </p>
            </div>
            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-sm font-black text-slate-700">
                Saknade mätvärden
              </p>
              <p className="mt-2 text-3xl font-black text-slate-950">
                {analytics?.missingMeteringValues ?? 0}
              </p>
              <p className="mt-2 text-xs font-bold text-slate-500">
                Öppna datakvalitetsfrågor
              </p>
            </div>
          </section>
          <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="text-lg font-black text-slate-950">
              Anläggningar och mätpunkter
            </h3>
            <div className="mt-4 grid gap-3 text-sm font-semibold text-slate-700 md:grid-cols-2 xl:grid-cols-4">
              <div>
                Antal anläggningar:{" "}
                <span className="font-black text-slate-950">
                  {analytics?.sites ?? sites.length}
                </span>
              </div>
              <div>
                Antal mätpunkter:{" "}
                <span className="font-black text-slate-950">
                  {analytics?.meteringPoints ?? meteringPoints.length}
                </span>
              </div>
              <div>
                SE-områden:{" "}
                <span className="font-black text-slate-950">
                  {analytics?.biddingZones.length
                    ? analytics.biddingZones.join(", ")
                    : "Saknas"}
                </span>
              </div>
              <div>
                Nätägare:{" "}
                <span className="font-black text-slate-950">
                  {analytics?.gridOwners.length
                    ? analytics.gridOwners.join(", ")
                    : "Saknas"}
                </span>
              </div>
            </div>
          </section>
        </SectionAnchor>
      ) : null}

      {canReadContracts && activeTab === "contracts" ? (
        <SectionAnchor
          id="contracts"
          title="Avtal"
          description={canWriteContracts ? "Visa, hantera och uppdatera kundens avtal." : "Visa kundens tecknade avtal och signeringsunderlag."}
        >
          <CustomerContractsCard
            customerId={id}
            companyId={customerCompanyId}
            canEdit={canWriteContracts}
          />
        </SectionAnchor>
      ) : null}

      {isPlatformAdmin && activeTab === "contacts-addresses" ? (
        <SectionAnchor
          id="contacts-addresses"
          title="Kontakter och adresser"
          description="Primära kontaktpersoner, adresser och kundens kontaktstruktur."
        >
          <CustomerContactsAddressesCard
            customerId={id}
            customerType={normalizedCustomerType}
            contacts={contacts}
            addresses={addresses}
            sites={sites}
          />
        </SectionAnchor>
      ) : null}

      <span id="anlaggning" aria-hidden className="block scroll-mt-36" />
      {activeTab === "sites" ? (
        <SectionAnchor
          id="sites"
          title="Anläggning och nätägare"
          description="Kundens anläggning, mätpunkt, nätägare och vad som eventuellt saknas."
        >
          <section className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-600">Anläggning</p>
                <p className="mt-2 text-lg font-semibold text-slate-950">
                  {customerCardSnapshot.primarySite?.facility_id ?? "Saknas"}
                </p>
                <p className="mt-1 text-sm text-slate-700">
                  {customerCardSnapshot.primarySite?.site_name ?? "Ingen anläggning vald"}
                </p>
              </div>
              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-600">Mätpunkt</p>
                <p className="mt-2 text-lg font-semibold text-slate-950">
                  {customerCardSnapshot.primaryMeteringPoint?.meter_point_id ?? "Saknas"}
                </p>
                <p className="mt-1 text-sm text-slate-700">Används för mätvärden och leverantörsbyte.</p>
              </div>
              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-600">Nätägare</p>
                <p className="mt-2 text-lg font-semibold text-slate-950">
                  {gridOwners.find((owner) => owner.id === (customerCardSnapshot.primaryMeteringPoint?.grid_owner_id ?? customerCardSnapshot.primarySite?.grid_owner_id ?? null))?.name ?? "Saknas"}
                </p>
                <p className="mt-1 text-sm text-slate-700">Behövs för uppgiftsbegäran och leverantörsbyte.</p>
              </div>
              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-600">Elområde</p>
                <p className="mt-2 text-lg font-semibold text-slate-950">
                  {customerCardSnapshot.primaryMeteringPoint?.price_area_code ?? customerCardSnapshot.primarySite?.price_area_code ?? "Saknas"}
                </p>
                <p className="mt-1 text-sm text-slate-700">Används för pris och fakturering.</p>
              </div>
            </div>
            {customerCardSnapshot.switchBlockerLabels.length > 0 ? (
              <div className="rounded-3xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
                <p className="font-semibold">Saknas innan nästa steg</p>
                <p className="mt-2">{customerCardSnapshot.switchBlockerLabels.join(", ")}</p>
              </div>
            ) : null}
            {isPlatformAdmin ? (
              <details className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <summary className="cursor-pointer text-sm font-semibold text-slate-900">Redigera anläggningsuppgifter</summary>
                <section className="mt-5 grid gap-6 xl:grid-cols-[460px_minmax(0,1fr)]">
                  <CustomerSiteForm
                    customerId={id}
                    gridOwners={gridOwners}
                    priceAreas={priceAreas}
                    site={safeSelectedSite}
                    cancelHref={`/admin/customers/${id}#anlaggning`}
                  />
                  <CustomerSitesTable
                    customerId={id}
                    sites={sites}
                    gridOwners={gridOwners}
                    meteringPoints={meteringPoints}
                    selectedSiteId={safeSelectedSite?.id ?? null}
                  />
                </section>
              </details>
            ) : null}
          </section>
        </SectionAnchor>
      ) : null}

      {isPlatformAdmin && activeTab === "metering-points" ? (
        <SectionAnchor
          id="metering-points"
          title="Mätpunkter"
          description="Skapa eller redigera kundens mätpunkter."
        >
          <section className="grid gap-6 xl:grid-cols-[460px_minmax(0,1fr)]">
            <MeteringPointForm
              customerId={id}
              sites={sites}
              gridOwners={gridOwners}
              priceAreas={priceAreas}
              meteringPoint={safeSelectedMeteringPoint}
              cancelHref={`/admin/customers/${id}#anlaggning`}
            />
            <MeteringPointsTable
              customerId={id}
              meteringPoints={meteringPoints}
              sites={sites}
              gridOwners={gridOwners}
              selectedMeteringPointId={safeSelectedMeteringPoint?.id ?? null}
            />
          </section>
        </SectionAnchor>
      ) : null}

      <span id="anteckningar" aria-hidden className="block scroll-mt-36" />
      {activeTab === "notes" ? (
        <SectionAnchor
          id="notes"
          title="Anteckningar"
          description="Intern drift- och kundhistorik."
        >
          <NotesSection customerId={id} notes={notes} />
        </SectionAnchor>
      ) : null}


      {activeTab === "communication" ? (
        <SectionAnchor
          id="communication"
          title="Kommunikation"
          description="Se vad som är köat, skickat eller misslyckat utan tekniska leverantörs-id:n."
        >
          <CustomerCommunicationSection
            logs={communicationLogs as CommunicationLog[]}
            isPlatformAdmin={isPlatformAdmin}
          />
        </SectionAnchor>
      ) : null}

      {activeTab === "lifecycle-decisions" ? (
        <SectionAnchor
          id="lifecycle-decisions"
          title="Ånger och avvisning"
          description="Stoppa leverantörsbyte och fakturering på kund-, avtals-, anläggnings- eller mätpunktsnivå."
        >
          <LifecycleDecisionSection
            customerId={id}
            sites={sites}
            meteringPoints={meteringPoints}
            contracts={customerContracts as CustomerContractRow[]}
          />
        </SectionAnchor>
      ) : null}

      {/* Teknisk diagnostik: platform/superadmin only, collapsed by default.
          Tenants never see raw Ediel/provider/webhook/audit details. */}
      {isPlatformAdmin && activeTab === "technical-details" ? (
        <>
          <span id="tekniskt" aria-hidden className="block scroll-mt-36" />
          <details className="rounded-3xl border border-slate-200 bg-white shadow-sm">
            <summary className="cursor-pointer px-6 py-4 text-base font-semibold text-slate-950">
              Teknisk diagnostik (endast plattformsadmin)
            </summary>
            <div className="space-y-6 border-t border-slate-200 p-6">
              <p className="text-sm text-slate-600">
                Avancerad drift, externa referenser, Ediel, provider-ID:n,
                webhook-händelser och audit. Den vanliga kundvyn innehåller
                endast affärsstatus och handläggaråtgärder.
              </p>
              <CustomerBusinessActionsCard
                customerId={id}
                companyId={customerCompanyId ?? undefined}
                sites={sites}
                meteringPoints={meteringPoints}
                powersOfAttorney={poaRows}
                documents={documentRows}
                infoRequests={customerInfoRequests}
                contracts={customerContracts as CustomerContractRow[]}
                switchRequests={switchRequests}
                snapshot={customerCardSnapshot}
                isPlatformAdmin
                z01RepairEvents={z01RepairEvents}
                dispatchState={customerDispatchState}
                manualRequests={manualRequestSummaries}
                billingUnderlays={billingUnderlays as Array<Record<string, unknown>>}
                isTestData={customer.is_test_data === true}
                showTechnicalDiagnostics
              />
              <CustomerWebsiteTraceabilityCard
                customer={customer}
                applications={websiteApplications as WebsiteApplicationAdminRow[]}
                billingPartners={
                  billingPartnerCustomers as BillingPartnerCustomerSummary[]
                }
                isPlatformAdmin={isPlatformAdmin}
              />
              <CustomerFacilityWorkflowCard
                customerId={id}
                sites={sites}
                meteringPoints={meteringPoints}
                infoRequests={customerInfoRequests}
                powersOfAttorney={poaRows}
                documents={documentRows}
                gridOwners={gridOwners}
                snapshot={customerCardSnapshot}
              />
              <CustomerPortalDataChainCard
                status={portalDataChain.status}
                rows={portalDataChain.rows}
              />
              <CustomerOperationsReadinessStrip items={readinessItems} />
              <CustomerEdielOperationsCard
                customerId={id}
                sites={sites}
                meteringPoints={meteringPoints}
                gridOwners={gridOwners}
                switchRequests={switchRequests}
                dataRequests={dataRequests}
                communicationRoutes={edielData.communicationRoutes}
                routeProfiles={edielData.routeProfiles}
                edielMessages={edielData.edielMessages}
                recommendationRoutes={edielData.recommendationRoutes}
                isPlatformAdmin={isPlatformAdmin}
              />
              <CustomerCommunicationSection
                logs={communicationLogs as CommunicationLog[]}
                isPlatformAdmin
              />
              <AuditSection
                auditLogs={auditLogs}
                sites={sites}
                meteringPoints={meteringPoints}
              />
            </div>
          </details>
        </>
      ) : null}
    </div>
  );
}
