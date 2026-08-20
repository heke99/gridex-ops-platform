import { readFile, writeFile } from 'node:fs/promises'

async function replaceOnce(path, from, to, label) {
  const source = await readFile(path, 'utf8')
  if (!source.includes(from)) throw new Error(`${label}: anchor missing in ${path}`)
  const next = source.replace(from, to)
  await writeFile(path, next)
  console.log(`updated ${label}: ${path}`)
}

const processPath = 'lib/website/customerApplicationProcess.ts'
let processSource = await readFile(processPath, 'utf8')

const oldSignature = `export async function processWebsiteCustomerApplication(input: {
  client: IntegrationApiClient;
  rawBody: unknown;
  idempotencyKey?: string | null;
  requestAudit?: RequestAuditMetadata;
}) {
  const idempotencyKey = input.idempotencyKey?.trim() ?? null;`
const newSignature = `export async function processWebsiteCustomerApplication(input: {
  client: IntegrationApiClient;
  rawBody: unknown;
  idempotencyKey?: string | null;
  requestAudit?: RequestAuditMetadata;
  portalIdentitySubmissionMode?: "pre_auth_required" | "post_auth_allowed";
}) {
  const portalIdentitySubmissionMode =
    input.portalIdentitySubmissionMode === "post_auth_allowed"
      ? "post_auth_allowed"
      : "pre_auth_required";
  const idempotencyKey = input.idempotencyKey?.trim() ?? null;`
if (!processSource.includes(oldSignature)) throw new Error('process signature anchor missing')
processSource = processSource.replace(oldSignature, newSignature)

const oldValidation = `  const authUserId = clean(body.auth_user_id);
  const customerPortalUserId = clean(body.customer_portal_user_id);
  if (!authUserId || !customerPortalUserId) {
    return failureResponse(
      new WebsiteApplicationError({
        message:
          "auth_user_id och customer_portal_user_id krävs och ska komma från samma verifierade serversession i tenantens Mina sidor.",
        status: 422,
        code: "portal_auth_identity_required",
        field: "customer_portal_user_id",
        stage: "validation",
        hint: "Skapa eller verifiera användaren i tenantens egen auth innan webbansökan skickas.",
      }),
    );
  }
  if (
    authUserId !== customerPortalUserId ||
    !isUuid(authUserId) ||
    !isUuid(customerPortalUserId)
  ) {
    return failureResponse(
      new WebsiteApplicationError({
        message:
          "auth_user_id och customer_portal_user_id måste vara samma UUID från den verifierade serversessionen.",
        status: 422,
        code: "portal_auth_identity_mismatch",
        field: "customer_portal_user_id",
        stage: "validation",
      }),
    );
  }`
const newValidation = `  const authUserId = clean(body.auth_user_id);
  const customerPortalUserId = clean(body.customer_portal_user_id);
  const hasAuthUserId = Boolean(authUserId);
  const hasCustomerPortalUserId = Boolean(customerPortalUserId);

  if (hasAuthUserId !== hasCustomerPortalUserId) {
    return failureResponse(
      new WebsiteApplicationError({
        message:
          "auth_user_id och customer_portal_user_id måste skickas tillsammans eller utelämnas tillsammans.",
        status: 422,
        code: "portal_auth_identity_mismatch",
        field: "customer_portal_user_id",
        stage: "validation",
        hint:
          "Skicka båda från samma verifierade serversession, eller utelämna båda när tenantens checkout tillåter post-auth onboarding.",
      }),
    );
  }

  if (
    !authUserId &&
    !customerPortalUserId &&
    portalIdentitySubmissionMode === "pre_auth_required"
  ) {
    return failureResponse(
      new WebsiteApplicationError({
        message:
          "Tenantens checkout-policy kräver verifierad portalidentitet före kundansökan.",
        status: 422,
        code: "portal_auth_identity_required",
        field: "customer_portal_user_id",
        stage: "validation",
        hint:
          "Skicka auth_user_id och customer_portal_user_id från samma verifierade serversession, eller aktivera post_auth_allowed för tenantens checkout-policy.",
      }),
    );
  }

  if (
    authUserId &&
    customerPortalUserId &&
    (authUserId !== customerPortalUserId ||
      !isUuid(authUserId) ||
      !isUuid(customerPortalUserId))
  ) {
    return failureResponse(
      new WebsiteApplicationError({
        message:
          "auth_user_id och customer_portal_user_id måste vara samma giltiga UUID från den verifierade serversessionen.",
        status: 422,
        code: "portal_auth_identity_mismatch",
        field: "customer_portal_user_id",
        stage: "validation",
      }),
    );
  }`
if (!processSource.includes(oldValidation)) throw new Error('portal validation anchor missing')
processSource = processSource.replace(oldValidation, newValidation)

const oldPortalLink = `    const portalUserId =
      clean(body.customer_portal_user_id) ??
      clean(body.auth_user_id) ??
      clean(body.web_auth_user_id) ??
      clean(body.external_account_id);
    if (!portalUserId) {
      throw new WebsiteApplicationError({
        message: "Mina sidor-identiteten saknas efter validering.",
        status: 500,
        code: "portal_auth_identity_missing_after_validation",
        stage: "portal_user_link",
        details: { retryable: false },
      });
    }
    const portalLink = await stage("portal_user_link", () =>
      ensureCustomerPortalUserLink({
        client: input.client,
        customerId: resolvedCustomerResult.customer.id,
        userId: portalUserId,
        email: normalizedEmail(body.customer.email),
        externalCustomerId,
        customerNumber,
        identityId: identity.id,
        matchMethod: "website_application_auth_user",
      }),
    );
    if (!portalLink?.accountId || !portalLink.identityId) {
      throw new WebsiteApplicationError({
        message: "Kundens Mina sidor-koppling kunde inte verifieras efter att kundgrafen skapades.",
        status: 503,
        code: "customer_portal_link_not_ready",
        stage: "portal_user_link",
        details: { retryable: true },
        hint: "Kontrollera customer_portal_accounts, customer_portal_identities och kör om fortsättningssteget.",
      });
    }`
const newPortalLink = `    const portalUserId =
      clean(body.customer_portal_user_id) ??
      clean(body.auth_user_id) ??
      clean(body.web_auth_user_id) ??
      clean(body.external_account_id);

    const portalLink = portalUserId
      ? await stage("portal_user_link", () =>
          ensureCustomerPortalUserLink({
            client: input.client,
            customerId: resolvedCustomerResult.customer.id,
            userId: portalUserId,
            email: normalizedEmail(body.customer.email),
            externalCustomerId,
            customerNumber,
            identityId: identity.id,
            matchMethod: "website_application_auth_user",
          }),
        )
      : null;

    if (portalUserId && (!portalLink?.accountId || !portalLink.identityId)) {
      throw new WebsiteApplicationError({
        message: "Kundens Mina sidor-koppling kunde inte verifieras efter att kundgrafen skapades.",
        status: 503,
        code: "customer_portal_link_not_ready",
        stage: "portal_user_link",
        details: { retryable: true },
        hint: "Kontrollera customer_portal_accounts, customer_portal_identities och kör om fortsättningssteget.",
      });
    }

    if (!portalUserId && portalIdentitySubmissionMode === "pre_auth_required") {
      throw new WebsiteApplicationError({
        message: "Portalidentiteten saknas trots tenantens pre-auth-policy.",
        status: 500,
        code: "portal_auth_identity_missing_after_validation",
        stage: "portal_user_link",
        details: { retryable: false },
      });
    }

    const effectivePortalIdentityId = portalLink?.identityId ?? identity.id;`
if (!processSource.includes(oldPortalLink)) throw new Error('portal link anchor missing')
processSource = processSource.replace(oldPortalLink, newPortalLink)

const oldResponse = `      portal_identity_id: identity.id,
      customer_site_id: site?.id ?? null,`
const newResponse = `      portal_identity_id: effectivePortalIdentityId,
      portal_identity_submission_mode: portalIdentitySubmissionMode,
      customer_portal_linked: Boolean(portalLink?.accountId && portalLink.identityId),
      customer_portal_link_pending: !portalLink,
      customer_site_id: site?.id ?? null,`
if (!processSource.includes(oldResponse)) throw new Error('response portal anchor missing')
processSource = processSource.replace(oldResponse, newResponse)

const oldSnapshot = `          agreement_confirmation_eligible: agreementConfirmationEligible,
          requested_start_date:`
const newSnapshot = `          agreement_confirmation_eligible: agreementConfirmationEligible,
          portal_identity_submission_mode: portalIdentitySubmissionMode,
          portal_identity_id: effectivePortalIdentityId,
          customer_portal_linked: Boolean(portalLink?.accountId && portalLink.identityId),
          requested_start_date:`
if (!processSource.includes(oldSnapshot)) throw new Error('workflow snapshot anchor missing')
processSource = processSource.replace(oldSnapshot, newSnapshot)

await writeFile(processPath, processSource)
console.log(`updated runtime: ${processPath}`)

await replaceOnce(
  'app/api/v1/website/customer-applications/route.ts',
  `      idempotencyKey: request.headers.get('idempotency-key')?.trim() || null,\n      requestAudit: requestAudit(request, requestId),\n    })`,
  `      idempotencyKey: request.headers.get('idempotency-key')?.trim() || null,\n      requestAudit: requestAudit(request, requestId),\n      portalIdentitySubmissionMode: readiness.portal_identity_submission_mode,\n    })`,
  'tenant policy route binding',
)

const finalizerPath = 'scripts/finalize-openapi-release.cjs'
let finalizer = await readFile(finalizerPath, 'utf8')
if (!finalizer.includes("const version = '2026-08-20.1'")) throw new Error('OpenAPI version anchor missing')
finalizer = finalizer.replace("const version = '2026-08-20.1'", "const version = '2026-08-20.2'")
if (!finalizer.includes("const priorVersion = '2026-08-19.2'")) throw new Error('OpenAPI prior version anchor missing')
finalizer = finalizer.replace("const priorVersion = '2026-08-19.2'", "const priorVersion = '2026-08-20.1'")

const oldRequired = `  'site_count',
  'auth_user_id',
  'customer_portal_user_id',
]))`
const newRequired = `  'site_count',
])).filter((field) => !['auth_user_id', 'customer_portal_user_id'].includes(field))`
if (!finalizer.includes(oldRequired)) throw new Error('OpenAPI required portal pair anchor missing')
finalizer = finalizer.replace(oldRequired, newRequired)

const oldDependent = `application.dependentRequired = {
  ...(application.dependentRequired ?? {}),
  auth_user_id: ['customer_portal_user_id'],
  customer_portal_user_id: ['auth_user_id'],
}`
const newDependent = `${oldDependent}
application.description =
  'Customer application for one authenticated tenant API client. auth_user_id and customer_portal_user_id are optional as a pair when the tenant policy is post_auth_allowed; when either is supplied both must be the same verified UUID.'
application.properties.auth_user_id.description =
  'Optional verified tenant-portal auth UUID. Must be supplied together with customer_portal_user_id and must match it.'
application.properties.customer_portal_user_id.description =
  'Optional verified tenant-portal user UUID. Must be supplied together with auth_user_id and must match it.'`
if (!finalizer.includes(oldDependent)) throw new Error('OpenAPI dependent portal pair anchor missing')
finalizer = finalizer.replace(oldDependent, newDependent)
await writeFile(finalizerPath, finalizer)
console.log(`updated contract source: ${finalizerPath}`)
