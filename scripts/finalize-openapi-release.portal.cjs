'use strict'

module.exports = function finalizeCustomerPortalRelease({
  application,
  canonicalErrorEnvelope,
  contractVersion,
  crypto,
  dateTime,
  envelope,
  fs,
  normalizeContractVersionMetadata,
  nullableString,
  portal,
  portalPath,
  priorVersion,
  publicContractsExample,
  publishedVersions,
  setRequest,
  setResponse,
  string,
  uuid,
  version,
  website,
  websitePath,
}) {
  const identifierProperties = {
    email: { type: 'string', format: 'email', maxLength: 320 },
    customer_number: { type: 'string', maxLength: 100 },
    external_customer_id: { type: 'string', maxLength: 200 },
    authenticated_user_reference: { type: 'string', maxLength: 200 },
  }
  portal.components.schemas.CustomerSyncRequest = {
    type: 'object',
    additionalProperties: false,
    anyOf: Object.keys(identifierProperties).map((key) => ({ required: [key] })),
    properties: {
      ...identifierProperties,
      profile: {
        type: 'object',
        additionalProperties: false,
        properties: {
          first_name: string,
          last_name: string,
          full_name: string,
          company_name: string,
          phone: string,
          invoice_email: { type: 'string', format: 'email' },
          language_code: string,
          timezone: string,
        },
      },
      facility_data: {
        type: 'array',
        maxItems: 20,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            facility_reference: string,
            facility_id: string,
            metering_point_id: string,
            move_in_date: { type: 'string', format: 'date' },
            requested_start_date: { type: 'string', format: 'date' },
            address: {
              type: 'object',
              additionalProperties: false,
              properties: {
                street: string,
                postal_code: string,
                city: string,
                country: string,
                care_of: string,
                apartment_number: string,
              },
            },
            metadata: { type: 'object' },
          },
        },
      },
      documents: {
        type: 'array',
        maxItems: 100,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            document_reference: string,
            document_type: string,
            title: string,
            status: string,
            secure_url: { type: 'string', format: 'uri' },
            file_name: string,
            mime_type: string,
            file_size_bytes: { type: 'integer', minimum: 0 },
            metadata: { type: 'object' },
          },
        },
      },
      legal_acceptances: {
        type: 'array',
        maxItems: 100,
        items: {
          type: 'object',
          additionalProperties: false,
          required: [
            'document_reference',
            'document_code',
            'document_version',
            'document_hash',
            'accepted',
            'accepted_at',
          ],
          properties: {
            document_reference: string,
            document_code: string,
            document_version: string,
            document_hash: { type: 'string', pattern: '^[a-fA-F0-9]{64}$' },
            accepted: { type: 'boolean', const: true },
            accepted_at: dateTime,
            metadata: { type: 'object' },
          },
        },
      },
      power_of_attorney: {
        type: 'object',
        additionalProperties: false,
        required: [
          'document_reference',
          'scope',
          'accepted',
          'accepted_at',
        ],
        description:
          'Tenant-synkad fullmakt. signer_name, signer_identity_number och method krävs för att fullmakten ska bli signerad och externt sändbar; äldre payload utan dessa lagras endast som ett ofullständigt utkast och blockerar leverantörsbyte.',
        properties: {
          power_of_attorney_reference: string,
          document_reference: {
            ...string,
            description:
              'Accepterar både den nya customer_documents-referensen för power_of_attorney och äldre exakt module_version-referens från samma tenantbundna legal bundle.',
          },
          scope: {
            type: 'array',
            minItems: 1,
            maxItems: 2,
            uniqueItems: true,
            items: {
              type: 'string',
              enum: ['supplier_switch', 'facility_information_lookup'],
            },
            contains: { const: 'supplier_switch' },
          },
          accepted: { type: 'boolean', const: true },
          accepted_at: dateTime,
          signer_name: string,
          signer_identity_number: string,
          method: string,
          ip_address: string,
          user_agent: string,
          valid_from: { type: 'string', format: 'date' },
          valid_to: { type: 'string', format: 'date' },
          metadata: { type: 'object' },
        },
      },
      metadata: { type: 'object' },
    },
  }
  portal.components.schemas.CustomerMoveOutRequest = {
    type: 'object',
    additionalProperties: false,
    required: ['facility_reference', 'requested_move_out_date'],
    properties: {
      ...identifierProperties,
      customer_contract_reference: string,
      facility_reference: string,
      requested_move_out_date: { type: 'string', format: 'date' },
      reason: string,
      new_address: { type: 'object' },
      contact_details: { type: 'object' },
      metadata: { type: 'object' },
    },
  }
  setRequest(
    portal,
    '/api/v1/customer/sync',
    { $ref: '#/components/schemas/CustomerSyncRequest' },
  )
  setRequest(
    portal,
    '/api/v1/customer/move-out',
    { $ref: '#/components/schemas/CustomerMoveOutRequest' },
  )
  portal.components.schemas.CustomerSyncData = {
    type: 'object',
    additionalProperties: false,
    required: ['status', 'customer_reference', 'summary'],
    properties: {
      status: { type: 'string', const: 'synced' },
      customer_reference: nullableString,
      customer_number: nullableString,
      external_customer_id: nullableString,
      summary: { type: 'object' },
    },
  }
  portal.components.schemas.CustomerMoveOutData = {
    type: 'object',
    additionalProperties: false,
    required: [
      'completion_reference',
      'customer_reference',
      'facility_reference',
      'requested_move_out_date',
      'status',
      'replayed',
    ],
    properties: {
      completion_reference: string,
      customer_reference: string,
      facility_reference: string,
      contract_reference: nullableString,
      requested_move_out_date: { type: 'string', format: 'date' },
      status: { type: 'string', const: 'submitted' },
      replayed: { type: 'boolean' },
    },
  }
  setResponse(
    portal,
    '/api/v1/customer/sync',
    envelope({ $ref: '#/components/schemas/CustomerSyncData' }),
    'post',
  )
  setResponse(
    portal,
    '/api/v1/customer/move-out',
    envelope({ $ref: '#/components/schemas/CustomerMoveOutData' }),
    'post',
  )
  portal.paths['/api/v1/customer/move-out'].post.responses['201'] =
    portal.paths['/api/v1/customer/move-out'].post.responses['200']


  // Runtime/OpenAPI hardening for release 2026-08-05.1. These overrides are
  // deliberately placed after legacy schema construction so the public contract
  // has one source of truth even while deprecated components remain resolvable.
  for (const document of [website, portal]) {
    document.components.schemas.ApiError = canonicalErrorEnvelope
    document.components.schemas.ErrorEnvelope = canonicalErrorEnvelope
    document.components.schemas.ErrorResponse = canonicalErrorEnvelope
    document.components.schemas.MarketPriceErrorEnvelope = canonicalErrorEnvelope
  }

  function closedObject(properties, required = []) {
    return { type: 'object', additionalProperties: false, required, properties }
  }

  function ensureStandardHeaders(document) {
    document.components.headers = document.components.headers ?? {}
    Object.assign(document.components.headers, {
      GridexContractVersion: {
        description: 'Canonical contract version used for this response.',
        schema: contractVersion,
      },
      RequestId: {
        description: 'Stable request identifier for support and audit.',
        schema: string,
      },
      RateLimitLimit: { schema: { type: 'integer', minimum: 1 } },
      RateLimitRemaining: { schema: { type: 'integer', minimum: 0 } },
      RateLimitReset: { schema: dateTime },
      RetryAfter: { schema: { type: 'integer', minimum: 1 } },
      ETag: { description: 'Strong entity tag for conditional retrieval.', schema: string },
      CacheControl: { description: 'Caching policy for this document.', schema: string },
      ContentType: { description: 'Response media type.', schema: string },
      ContentDisposition: { description: 'Suggested inline filename.', schema: string },
      Vary: { description: 'Request headers that affect cache validation.', schema: string },
    })

    function addHeaders(response, status) {
      if (!response || typeof response !== 'object' || response.$ref) return
      response.headers = {
        ...(response.headers ?? {}),
        'X-Gridex-Contract-Version': { $ref: '#/components/headers/GridexContractVersion' },
        'X-Request-ID': { $ref: '#/components/headers/RequestId' },
        'X-RateLimit-Limit': { $ref: '#/components/headers/RateLimitLimit' },
        'X-RateLimit-Remaining': { $ref: '#/components/headers/RateLimitRemaining' },
        'X-RateLimit-Reset': { $ref: '#/components/headers/RateLimitReset' },
        ...(String(status) === '429'
          ? { 'Retry-After': { $ref: '#/components/headers/RetryAfter' } }
          : {}),
      }
    }
    for (const response of Object.values(document.components.responses ?? {})) {
      addHeaders(response, '')
    }
    for (const item of Object.values(document.paths ?? {})) {
      for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
        const operation = item?.[method]
        if (!operation) continue
        for (const [status, response] of Object.entries(operation.responses ?? {})) {
          addHeaders(response, status)
        }
      }
    }
  }


  function ensureCanonicalErrorResponses(document) {
    for (const item of Object.values(document.paths ?? {})) {
      for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
        const operation = item?.[method]
        if (!operation) continue
        for (const [status, original] of Object.entries(operation.responses ?? {})) {
          if (!/^[45]\d\d$/.test(String(status))) continue
          const referenced = original?.$ref?.startsWith('#/components/responses/')
            ? document.components?.responses?.[original.$ref.split('/').at(-1)]
            : null
          const source = referenced ?? original ?? {}
          operation.responses[status] = {
            description: source.description ?? 'Canonical API error.',
            ...(source.headers ? { headers: source.headers } : {}),
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorEnvelope' },
              },
            },
          }
        }
      }
    }
  }

  function ensureSecurityFromScopeExtensions(document) {
    for (const item of Object.values(document.paths ?? {})) {
      for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
        const operation = item?.[method]
        if (!operation) continue
        const scopes = operation['x-required-scopes']
        if (!Array.isArray(scopes) || scopes.length === 0) continue
        const scopeMode = String(operation['x-scope-mode'] ?? 'all')
        const bearerRequirements = scopeMode.startsWith('any')
          ? scopes.map((scope) => ({ bearerAuth: [scope] }))
          : [{ bearerAuth: scopes }]
        operation.security = [...bearerRequirements, { legacyApiKeyAuth: [] }]
      }
    }
  }

  function ensureParameterRef(operation, ref) {
    if (!operation) return
    const parameters = Array.isArray(operation.parameters)
      ? operation.parameters
      : []
    if (!parameters.some((parameter) => parameter?.$ref === ref)) {
      operation.parameters = [...parameters, { $ref: ref }]
    }
  }

  function dedupeOperationParameters(document) {
    for (const item of Object.values(document.paths ?? {})) {
      for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
        const operation = item?.[method]
        if (!operation || !Array.isArray(operation.parameters)) continue
        const seen = new Set()
        operation.parameters = operation.parameters.filter((parameter) => {
          const key = parameter?.$ref
            ? `ref:${parameter.$ref}`
            : `parameter:${parameter?.in ?? ''}:${parameter?.name ?? JSON.stringify(parameter)}`
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })
      }
    }
  }

  function removeMisappliedLegalDescription(document) {
    function walk(value, key = '') {
      if (!value || typeof value !== 'object') return
      if (
        value.description === 'Stable external reference for the locked legal bundle version.' &&
        !/legal_bundle/i.test(key)
      ) delete value.description
      for (const [childKey, child] of Object.entries(value)) walk(child, childKey)
    }
    walk(document)
  }

  const publicReferenceSchema = {
    type: ['string', 'null'],
    pattern: '^[a-z][a-z0-9_]{1,31}_[A-Za-z0-9_-]{20,64}$',
  }
  const checkoutAgreementStatus = closedObject({
    status: nullableString,
    contract_number: nullableString,
    signed_at: nullableString,
    withdrawal_deadline_at: nullableString,
    signature_snapshot_sha256: nullableString,
  }, ['status', 'contract_number', 'signed_at', 'withdrawal_deadline_at', 'signature_snapshot_sha256'])
  const checkoutConfirmationEmailStatus = closedObject({
    expected: { type: 'boolean' },
    status: { type: 'string', enum: ['not_expected', 'pending', 'queued', 'sent', 'delivered', 'failed'] },
  }, ['expected', 'status'])
  website.components.schemas.WebsiteCheckoutResult = closedObject({
    outcome: { type: 'string', enum: ['agreement_signed', 'customer_action_required', 'application_received'] },
    thank_you_ready: { type: 'boolean' },
    page_state: { type: 'string', enum: ['success', 'success_action_required', 'action_required', 'processing'] },
    customer_action_required: { type: 'boolean' },
    application: closedObject({
      application_number: nullableString,
      status: nullableString,
    }, ['application_number', 'status']),
    agreement: checkoutAgreementStatus,
    confirmation_email: checkoutConfirmationEmailStatus,
    status_path: nullableString,
  }, [
    'outcome', 'thank_you_ready', 'page_state', 'customer_action_required',
    'application', 'agreement', 'confirmation_email', 'status_path',
  ])
  const websiteApplicationData = website.components.schemas.WebsiteCustomerApplicationData
  for (const internalField of [
    'customer_id', 'application_id', 'customer_site_id', 'metering_point_id',
    'contract_id', 'workflow_id', 'continuation_job_id', 'site_id', 'resolution_id',
  ]) delete websiteApplicationData.properties[internalField]
  websiteApplicationData.required = (websiteApplicationData.required ?? []).filter(
    (field) => ![
      'customer_id', 'application_id', 'customer_site_id', 'metering_point_id',
      'contract_id', 'workflow_id', 'continuation_job_id', 'site_id', 'resolution_id',
    ].includes(field),
  )
  Object.assign(websiteApplicationData.properties, {
    application_number: string,
    customer_reference: publicReferenceSchema,
    application_reference: publicReferenceSchema,
    facility_reference: publicReferenceSchema,
    metering_point_reference: publicReferenceSchema,
    contract_reference: publicReferenceSchema,
    checkout: { $ref: '#/components/schemas/WebsiteCheckoutResult' },
    supplier_switch: closedObject({
      request_reference: publicReferenceSchema,
      status: { type: 'string', enum: ['created', 'not_created'] },
      can_create_request: { type: 'boolean' },
      can_dispatch: { type: 'boolean' },
      blockers: { type: 'array', items: string },
      next_action: string,
    }, ['request_reference', 'status', 'can_create_request', 'can_dispatch', 'blockers', 'next_action']),
  })
  websiteApplicationData.required = Array.from(new Set([
    ...(websiteApplicationData.required ?? []),
    'application_number',
    'checkout',
    'supplier_switch',
  ]))
  website.components.schemas.WebsiteCustomerApplicationResponse = envelope({
    $ref: '#/components/schemas/WebsiteCustomerApplicationData',
  })
  setResponse(
    website,
    '/api/v1/website/customer-applications',
    { $ref: '#/components/schemas/WebsiteCustomerApplicationResponse' },
    'post',
    '200',
  )
  if (website.paths['/api/v1/website/customer-applications']?.post) {
    website.paths['/api/v1/website/customer-applications'].post.description =
      'Scope: website_applications.write. Idempotency-Key krävs. Tenant härleds enbart från API-nyckeln. auth_user_id och customer_portal_user_id krävs som samma verifierade UUID. OPS committar canonical kund, kundnummer, site/mätpunkt, avtal, juridik, portalidentitet, workflow och ett beständigt customer_application_continuation-jobb. data.checkout är tenantens enda maskinläsbara sanning för tack-sidan: thank_you_ready=true betyder att avtalet faktiskt är signerat och kan visas som tecknat. confirmation_email.status visar separat om avtalsbekräftelsen är pending, queued, sent, delivered eller failed. E-post, anläggningsuppslag, leverantörsbyte och webhooks fortsätter asynkront och följs via statusendpointen.'
  }
  if (website.paths['/api/v1/website/customer-applications/{application_id}']) {
    website.paths['/api/v1/website/customer-applications/{application_number}'] =
      website.paths['/api/v1/website/customer-applications/{application_id}']
    delete website.paths['/api/v1/website/customer-applications/{application_id}']
  }
  const applicationStatusPath = website.paths['/api/v1/website/customer-applications/{application_number}']
  if (applicationStatusPath?.get) {
    applicationStatusPath.get.description =
      'Scope: website_switch_status.read. application_number is resolved strictly inside the API-key tenant. Internal database UUIDs are never accepted or returned.'
    applicationStatusPath.get.parameters = (applicationStatusPath.get.parameters ?? []).map((parameter) => {
      if (parameter?.in === 'path') {
        return { ...parameter, name: 'application_number', required: true, schema: string }
      }
      return parameter
    })
  }
  const applicationAutomationStatus = closedObject({
    status: string,
    attempts: { type: 'integer', minimum: 0 },
    max_attempts: { type: 'integer', minimum: 0 },
    next_retry_at: nullableString,
    completed_at: nullableString,
    last_error: nullableString,
  }, ['status', 'attempts', 'max_attempts'])
  const applicationCommunicationEntry = closedObject({
    event_type: nullableString,
    status: string,
    occurred_at: nullableString,
    message: nullableString,
  }, ['event_type', 'status'])
  const applicationCommunicationStatus = closedObject({
    pending: { type: 'boolean' },
    source_of_truth: { type: 'string', const: 'tenant_email_outbox+communication_logs' },
    triggered: { type: 'array', items: applicationCommunicationEntry },
    queued: { type: 'array', items: applicationCommunicationEntry },
    sent: { type: 'array', items: applicationCommunicationEntry },
    failed: { type: 'array', items: applicationCommunicationEntry },
  }, ['pending', 'source_of_truth', 'triggered', 'queued', 'sent', 'failed'])
  const applicationWebhookStatus = closedObject({
    status: { type: 'string', enum: ['not_triggered', 'not_configured', 'pending', 'sent', 'failed'] },
    fanout_status: { type: 'string', enum: ['not_started', 'pending', 'completed', 'failed'] },
    queued: { type: 'integer', minimum: 0 },
    sent: { type: 'integer', minimum: 0 },
    failed: { type: 'integer', minimum: 0 },
    attempts: { type: 'integer', minimum: 0 },
    next_retry_at: nullableString,
    last_error: nullableString,
    updated_at: nullableString,
  }, ['status', 'fanout_status', 'queued', 'sent', 'failed', 'attempts'])
  const canonicalApplicationStatusProperties = {
    application_number: string,
    status: { type: 'string', enum: ['processing', 'accepted', 'needs_customer_information', 'rejected', 'failed', 'completed'] },
    stage: string,
    customer_number: nullableString,
    contract_number: nullableString,
    contract_status: nullableString,
    signed_at: nullableString,
    withdrawal_deadline_at: nullableString,
    signature_snapshot_sha256: nullableString,
    supplier_switch_status: string,
    supply_status: nullableString,
    requested_start_date: nullableString,
    confirmed_start_date: nullableString,
    missing_customer_action: { type: 'boolean' },
    next_step: nullableString,
    blocking_reason: nullableString,
    automation: applicationAutomationStatus,
    communication: applicationCommunicationStatus,
    checkout: { $ref: '#/components/schemas/WebsiteCheckoutResult' },
    webhook: applicationWebhookStatus,
    updated_at: nullableString,
  }
  const canonicalApplicationStatusRequired = [
    'application_number', 'status', 'stage', 'supplier_switch_status',
    'missing_customer_action', 'automation', 'communication', 'checkout', 'webhook',
  ]
  if (website.components.schemas.CustomerApplicationStatus) {
    website.components.schemas.CustomerApplicationStatus = closedObject(
      canonicalApplicationStatusProperties,
      canonicalApplicationStatusRequired,
    )
  }
  website.components.schemas.WebsiteCustomerApplicationStatusData = closedObject(
    canonicalApplicationStatusProperties,
    canonicalApplicationStatusRequired,
  )
  if (applicationStatusPath?.get) {
    setResponse(
      website,
      '/api/v1/website/customer-applications/{application_number}',
      envelope({ $ref: '#/components/schemas/WebsiteCustomerApplicationStatusData' }),
    )
  }

  if (website.components.schemas.WebsiteEnergyAreaResolveResponse) {
    website.components.schemas.WebsiteEnergyAreaResolveResponse.properties.contract_schema_version = contractVersion
    website.components.schemas.WebsiteEnergyAreaResolveResponse.required = Array.from(new Set([
      ...(website.components.schemas.WebsiteEnergyAreaResolveResponse.required ?? []),
      'contract_schema_version',
    ]))
  }

  for (const [path, scopes] of [
    ['/api/v1/integration/context', ['integration_context.read']],
    ['/api/v1/website/switch-status', ['website_switch_status.read']],
  ]) {
    const operation = website.paths[path]?.get
    if (!operation) continue
    operation.security = [{ bearerAuth: scopes }]
    operation['x-required-scopes'] = scopes
  }
  const legalOperation = website.paths['/api/v1/website/legal-bundle']?.get
  if (legalOperation) {
    legalOperation.security = [
      { bearerAuth: ['website_legal.read'] },
      { bearerAuth: ['website_contracts.read'] },
    ]
    legalOperation['x-required-scopes'] = ['website_legal.read', 'website_contracts.read']
    legalOperation['x-scope-mode'] = 'any'
    legalOperation['x-scope-requirement'] = {
      anyOf: ['website_legal.read', 'website_contracts.read'],
    }
  }

  const eventIdentity = closedObject({
    external_customer_id: string,
    customer_number: string,
    auth_user_id: uuid,
    customer_portal_user_id: uuid,
    email: { type: 'string', format: 'email' },
  })
  const customerEventRequest = closedObject({
    event_type: { type: 'string', pattern: '^customer\\.[a-z0-9_]+$' },
    event_reference: { type: 'string', minLength: 1, maxLength: 200 },
    occurred_at: dateTime,
    customer: eventIdentity,
    subject: closedObject({ type: string, reference: string }, ['type']),
    data: { type: 'object' },
    metadata: { type: 'object' },
  }, ['event_type', 'event_reference', 'occurred_at', 'customer', 'subject', 'data'])
  const customerEventData = closedObject({
    event_reference: string,
    event_resource_reference: publicReferenceSchema,
    event_type: string,
    customer_reference: nullableString,
    status: { type: 'string', const: 'accepted' },
    occurred_at: dateTime,
    replayed: { type: 'boolean' },
  }, ['event_reference', 'event_resource_reference', 'event_type', 'customer_reference', 'status', 'occurred_at', 'replayed'])
  website.components.schemas.WebsiteCustomerEventIdentity = eventIdentity
  website.components.schemas.WebsiteCustomerEventRequest = customerEventRequest
  website.components.schemas.WebsiteCustomerEventData = customerEventData
  setRequest(website, '/api/v1/website/customer-events', { $ref: '#/components/schemas/WebsiteCustomerEventRequest' })
  setResponse(website, '/api/v1/website/customer-events', envelope({ $ref: '#/components/schemas/WebsiteCustomerEventData' }), 'post')

  portal.components.schemas.CustomerNotificationReadRequest = closedObject({
    notification_references: { type: 'array', minItems: 1, maxItems: 100, uniqueItems: true, items: publicReferenceSchema },
  }, ['notification_references'])
  portal.components.schemas.CustomerNotificationReadData = closedObject({
    updated_count: { type: 'integer', minimum: 0 },
    notification_references: { type: 'array', items: publicReferenceSchema },
    read_at: dateTime,
  }, ['updated_count', 'notification_references', 'read_at'])
  setRequest(portal, '/api/v1/customer/notifications/read', { $ref: '#/components/schemas/CustomerNotificationReadRequest' })
  setResponse(portal, '/api/v1/customer/notifications/read', envelope({
    $ref: '#/components/schemas/CustomerNotificationReadData',
  }), 'post')

  portal.components.schemas.CustomerProfile = {
    ...closedObject({
    first_name: string,
    last_name: string,
    full_name: string,
    company_name: string,
    email: { type: 'string', format: 'email' },
    phone: string,
    invoice_email: { type: 'string', format: 'email' },
    language_code: string,
    timezone: string,
    }),
    minProperties: 1,
  }
  const customerFacilityAddress = {
    ...closedObject({
      street: string,
      postal_code: string,
      city: string,
      country: string,
      care_of: string,
      apartment_number: string,
    }),
    minProperties: 1,
  }
  portal.components.schemas.CustomerFacilityUpdate = closedObject({
    facility_reference: string,
    address: customerFacilityAddress,
    external_request_id: string,
  }, ['facility_reference', 'address'])
  portal.components.schemas.CustomerProfileUpdateRequest = {
    type: 'object',
    additionalProperties: false,
    anyOf: [{ required: ['profile'] }, { required: ['facility_data'] }],
    properties: {
      profile: { $ref: '#/components/schemas/CustomerProfile' },
      facility_data: { $ref: '#/components/schemas/CustomerFacilityUpdate' },
      metadata: { type: 'object' },
    },
  }
  portal.components.schemas.CustomerProfileUpdateData = closedObject({
    completion_reference: string,
    status: string,
    created_at: dateTime,
    profile_updated: { type: 'boolean' },
    facility_updated: { type: 'boolean' },
    address_result: { type: ['object', 'null'] },
  }, ['completion_reference', 'status', 'created_at', 'profile_updated', 'facility_updated', 'address_result'])
  setRequest(portal, '/api/v1/customer/profile-update', { $ref: '#/components/schemas/CustomerProfileUpdateRequest' })
  setResponse(portal, '/api/v1/customer/profile-update', envelope({ $ref: '#/components/schemas/CustomerProfileUpdateData' }), 'post')
  const profileOperation = portal.paths['/api/v1/customer/profile-update']?.post
  if (profileOperation) {
    profileOperation.security = [
      { bearerAuth: ['customer_contact.write'] },
      { bearerAuth: ['customer_facility_data.write'] },
    ]
    profileOperation['x-required-scopes'] = ['customer_contact.write', 'customer_facility_data.write']
    profileOperation['x-scope-mode'] = 'any-per-request; both required when both operations are present'
    profileOperation['x-scope-requirement'] = {
      anyOf: ['customer_contact.write', 'customer_facility_data.write'],
      allOfWhenBothPayloadSectionsArePresent: [
        'customer_contact.write',
        'customer_facility_data.write',
      ],
    }
  }

  portal.components.schemas.CustomerEventIdentity = eventIdentity
  portal.components.schemas.CustomerEventRequest = customerEventRequest
  portal.components.schemas.CustomerEventData = customerEventData
  portal.components.schemas.PublicDomainEvent = closedObject({
    event_id: string,
    event_type: string,
    created_at: dateTime,
    tenant_reference: string,
    environment: { type: ['string', 'null'], enum: ['test', 'production', null] },
    aggregate: closedObject({ type: string, reference: string }, ['type', 'reference']),
    customer: closedObject({ customer_reference: nullableString, customer_number: nullableString }),
    data: { type: 'object' },
    contract_schema_version: contractVersion,
  }, ['event_id', 'event_type', 'created_at', 'tenant_reference', 'environment', 'aggregate', 'data', 'contract_schema_version'])
  portal.components.schemas.DomainEventListData = {
    type: 'array',
    items: { $ref: '#/components/schemas/PublicDomainEvent' },
  }
  setRequest(portal, '/api/v1/events', { $ref: '#/components/schemas/CustomerEventRequest' }, 'post')
  setResponse(portal, '/api/v1/events', envelope({ $ref: '#/components/schemas/CustomerEventData' }), 'post')
  setResponse(portal, '/api/v1/events', {
    type: 'object',
    additionalProperties: false,
    required: ['data', 'next_before', 'request_id', 'contract_schema_version'],
    properties: {
      data: { $ref: '#/components/schemas/DomainEventListData' },
      next_before: nullableString,
      request_id: string,
      correlation_id: nullableString,
      contract_schema_version: contractVersion,
    },
  }, 'get')
  const eventsGet = portal.paths['/api/v1/events']?.get
  if (eventsGet) {
    const queryNames = new Set(['event_type', 'external_customer_id', 'before', 'limit'])
    eventsGet.parameters = [
      ...(eventsGet.parameters ?? []).filter((parameter) =>
        !(parameter?.in === 'query' && queryNames.has(parameter?.name)),
      ),
      { name: 'event_type', in: 'query', required: false, schema: { type: 'string', pattern: '^customer\\.[a-z0-9_]+$' } },
      { name: 'external_customer_id', in: 'query', required: false, schema: string },
      { name: 'before', in: 'query', required: false, schema: dateTime },
      { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 100, default: 100 } },
    ]
  }

  website.components.parameters = website.components.parameters ?? {}
  website.components.parameters.IdempotencyKey = {
    name: 'Idempotency-Key',
    in: 'header',
    required: true,
    schema: {
      type: 'string',
      minLength: 8,
      maxLength: 200,
      pattern: '^[A-Za-z0-9._:+~-]+$',
    },
  }
  ensureParameterRef(
    website.paths['/api/v1/website/customer-events']?.post,
    '#/components/parameters/IdempotencyKey',
  )


  function clone(value) {
    return JSON.parse(JSON.stringify(value))
  }

  function ensureVersionedOpenApiRoutes() {
    const websiteCurrent = website.paths['/api/v1/openapi/website-integration-v1.json']
    const portalCurrent = website.paths['/api/v1/openapi/customer-portal-v1.json']
    if (websiteCurrent) {
      website.paths[`/api/v1/openapi/${priorVersion}/website-integration-v1.json`] = clone(websiteCurrent)
      website.paths[`/api/v1/openapi/${version}/website-integration-v1.json`] = clone(websiteCurrent)
    }
    if (portalCurrent) {
      website.paths[`/api/v1/openapi/${priorVersion}/customer-portal-v1.json`] = clone(portalCurrent)
      website.paths[`/api/v1/openapi/${version}/customer-portal-v1.json`] = clone(portalCurrent)
    }
    const portalDocumentCurrent = portal.paths['/api/v1/openapi/customer-portal-v1.json']
    if (portalDocumentCurrent) {
      portal.paths[`/api/v1/openapi/${priorVersion}/customer-portal-v1.json`] = clone(portalDocumentCurrent)
      portal.paths[`/api/v1/openapi/${version}/customer-portal-v1.json`] = clone(portalDocumentCurrent)
    }
  }

  function movePublicationWebhookToTopLevel() {
    const pathItem = website.paths['/webhooks/contracts.publication.changed']
    if (!pathItem) return
    delete website.paths['/webhooks/contracts.publication.changed']
    const webhook = clone(pathItem)
    const operation = webhook.post
    if (operation) {
      operation.summary = 'Receive contracts.publication.changed from Gridex'
      operation.description = 'This callback URL is hosted by the tenant, not by app.gridex.se. Gridex signs the exact raw request body with HMAC-SHA256 over `${timestamp}.${rawBody}`. Verify timestamp freshness and X-Gridex-Signature, then deduplicate X-Gridex-Event-Id and X-Gridex-Delivery-Id before returning any 2xx response. Non-2xx responses enter the documented retry and dead-letter pipeline.'
      operation.security = []
      delete operation['x-required-scopes']
      delete operation['x-scope-mode']
      operation.parameters = [
        { name: 'X-Gridex-Event-Id', in: 'header', required: true, schema: { type: 'string', pattern: '^event_[a-f0-9]{32}$' } },
        { name: 'X-Gridex-Delivery-Id', in: 'header', required: true, schema: { type: 'string', pattern: '^delivery_[a-f0-9]{32}$' } },
        { name: 'X-Gridex-Timestamp', in: 'header', required: true, schema: { type: 'string' } },
        { name: 'X-Gridex-Signature', in: 'header', required: true, schema: { type: 'string', pattern: '^sha256=[a-f0-9]{64}$' } },
      ]
      operation.responses = {
        '2XX': { description: 'Event accepted and durably deduplicated by the tenant receiver.' },
      }
    }
    website.webhooks = website.webhooks ?? {}
    website.webhooks.contractsPublicationChanged = webhook
  }

  function staticDocumentHeaders() {
    return {
      'X-Gridex-Contract-Version': { $ref: '#/components/headers/GridexContractVersion' },
      'X-Request-ID': { $ref: '#/components/headers/RequestId' },
      ETag: { $ref: '#/components/headers/ETag' },
      Vary: { $ref: '#/components/headers/Vary' },
      'Cache-Control': { $ref: '#/components/headers/CacheControl' },
      'Content-Type': { $ref: '#/components/headers/ContentType' },
      'Content-Disposition': { $ref: '#/components/headers/ContentDisposition' },
    }
  }

  function normalizePublicOpenApiDocumentOperations(document) {
    const paths = [
      '/api/v1/openapi/release-manifest.json',
      '/api/v1/openapi/website-integration-v1.json',
      '/api/v1/openapi/customer-portal-v1.json',
      ...publishedVersions.flatMap((publishedVersion) => [
        `/api/v1/openapi/${publishedVersion}/website-integration-v1.json`,
        `/api/v1/openapi/${publishedVersion}/customer-portal-v1.json`,
      ]),
    ]
    for (const path of paths) {
      const operation = document.paths?.[path]?.get
      if (!operation) continue
      const immutableMatch = path.match(/^\/api\/v1\/openapi\/(\d{4}-\d{2}-\d{2}\.\d+)\/(website-integration-v1|customer-portal-v1)\.json$/)
      if (immutableMatch) {
        const versionToken = immutableMatch[1].replace(/[^0-9A-Za-z]/g, '')
        const documentToken = immutableMatch[2] === 'website-integration-v1'
          ? 'WebsiteIntegrationV1Json'
          : 'CustomerPortalV1Json'
        operation.operationId = `getApiV1Openapi${versionToken}${documentToken}`
      }
      operation.security = []
      operation['x-required-scopes'] = []
      operation['x-scope-mode'] = 'all'
      operation['x-rate-limit-class'] = 'read'
      operation['x-idempotency-required'] = false
      operation['x-cache-policy'] = immutableMatch ? 'public-immutable' : 'private-revalidate'
      operation['x-public-id-policy'] = 'none'
      if (path === '/api/v1/openapi/release-manifest.json') {
        operation.operationId = 'getApiV1OpenapiReleaseManifestJson'
      }
      const response200 = operation.responses?.['200']
      if (response200 && !response200.$ref) response200.headers = staticDocumentHeaders()
      operation.responses = operation.responses ?? {}
      operation.responses['304'] = {
        description: 'Not Modified. The supplied If-None-Match value matches the current ETag.',
        headers: staticDocumentHeaders(),
      }
    }
  }

  ensureVersionedOpenApiRoutes()
  movePublicationWebhookToTopLevel()

  for (const document of [website, portal]) {
    dedupeOperationParameters(document)
    ensureSecurityFromScopeExtensions(document)
    ensureCanonicalErrorResponses(document)
    ensureStandardHeaders(document)
    normalizePublicOpenApiDocumentOperations(document)
    removeMisappliedLegalDescription(document)
  }

  function explicitlyPermissive(schema) {
    return schema?.type === 'object' && (
      schema.additionalProperties === true ||
      (
        schema.additionalProperties !== false &&
        Object.keys(schema.properties ?? {}).length === 0
      )
    )
  }

  for (const [path, item] of Object.entries(portal.paths)) {
    if (path.includes('/openapi/') || path === '/api/v1/integration/context') continue
    for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
      const operation = item[method]
      if (!operation) continue
      const request = operation.requestBody?.content?.['application/json']?.schema
      if (
        explicitlyPermissive(request) &&
        path !== '/api/v1/customer-portal/sync'
      ) {
        operation.requestBody.content['application/json'].schema = {
          $ref: '#/components/schemas/ClosedPortalMutationRequest',
        }
      }
      const response = operation.responses?.['200']?.content?.['application/json']?.schema
      if (
        explicitlyPermissive(response) &&
        path !== '/api/v1/customer-portal/sync'
      ) {
        operation.responses['200'].content['application/json'].schema = {
          $ref: '#/components/schemas/ClosedPortalResourceEnvelope',
        }
      }
    }
  }

  function assertLocalRefs(document, name) {
    const failures = []
    function walk(value) {
      if (!value || typeof value !== 'object') return
      if (typeof value.$ref === 'string' && value.$ref.startsWith('#/')) {
        let cursor = document
        for (const part of value.$ref.slice(2).split('/')) {
          cursor = cursor?.[part.replace(/~1/g, '/').replace(/~0/g, '~')]
        }
        if (cursor === undefined) failures.push(value.$ref)
      }
      for (const child of Object.values(value)) walk(child)
    }
    walk(document)
    if (failures.length) {
      throw new Error(`${name} contains unresolved refs: ${[...new Set(failures)].join(', ')}`)
    }
  }

  assertLocalRefs(website, 'website')
  assertLocalRefs(portal, 'customer portal')

  // Re-normalize after late example assignment so fixture/example versions cannot
  // drift from info.version / x-contract-schema-version.
  for (const document of [website, portal]) {
    normalizeContractVersionMetadata(document)
  }

  fs.writeFileSync(websitePath, `${JSON.stringify(website, null, 2)}\n`)
  fs.writeFileSync(portalPath, `${JSON.stringify(portal, null, 2)}\n`)
  fs.writeFileSync(`docs/fixtures/public-contracts-response-${version}.json`, `${JSON.stringify(publicContractsExample, null, 2)}\n`)
  const hashes = {
    website: crypto
      .createHash('sha256')
      .update(`${JSON.stringify(website, null, 2)}\n`)
      .digest('hex'),
    customer_portal: crypto
      .createHash('sha256')
      .update(`${JSON.stringify(portal, null, 2)}\n`)
      .digest('hex'),
  }
  console.log(JSON.stringify({ version, hashes }, null, 2))
}
