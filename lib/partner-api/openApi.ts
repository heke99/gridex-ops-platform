export const PARTNER_API_VERSION = '2026-08-16.1'
export const PARTNER_API_BASE_URL = 'https://app.gridex.se/api/partner/v1'

const errorResponse = {
  description: 'Error',
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/ErrorResponse' },
    },
  },
}

const idempotencyHeader = {
  name: 'Idempotency-Key',
  in: 'header',
  required: true,
  schema: { type: 'string', minLength: 8, maxLength: 200 },
  description: 'Stable unique key for this business write. Reuse only for an identical retry.',
}

export const partnerOpenApi = {
  openapi: '3.1.0',
  info: {
    title: 'Gridex Partner API',
    version: PARTNER_API_VERSION,
    description:
      'Backend-to-backend API for electricity suppliers and integration partners. Supplier configuration is managed in Gridex and is not exposed through this API.',
  },
  servers: [{ url: PARTNER_API_BASE_URL }],
  security: [{ BearerAuth: [] }],
  paths: {
    '/contracts': {
      post: {
        summary: 'Register contract',
        description: 'Recommended combined flow. Creates the customer, site and contract, and optionally a signed power of attorney.',
        parameters: [idempotencyHeader],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CreateContractRequest' },
            },
          },
        },
        responses: { '201': { description: 'Created' }, '400': errorResponse, '401': errorResponse, '403': errorResponse, '409': errorResponse, '422': errorResponse },
      },
    },
    '/contracts/{contract_reference}': {
      get: {
        summary: 'Get contract',
        parameters: [{ $ref: '#/components/parameters/ContractReference' }],
        responses: { '200': { description: 'Contract' }, '404': errorResponse },
      },
    },
    '/contracts/{contract_reference}/status': {
      get: {
        summary: 'Get contract status',
        parameters: [{ $ref: '#/components/parameters/ContractReference' }],
        responses: { '200': { description: 'Contract status' }, '404': errorResponse },
      },
    },
    '/customers': {
      post: {
        summary: 'Create customer',
        parameters: [idempotencyHeader],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/CustomerInput' } } } },
        responses: { '201': { description: 'Created' }, '409': errorResponse, '422': errorResponse },
      },
    },
    '/customers/{customer_reference}': {
      get: {
        summary: 'Get customer',
        parameters: [{ $ref: '#/components/parameters/CustomerReference' }],
        responses: { '200': { description: 'Customer' }, '404': errorResponse },
      },
    },
    '/customers/{customer_reference}/invoices': {
      get: {
        summary: 'List customer invoices',
        parameters: [
          { $ref: '#/components/parameters/CustomerReference' },
          { name: 'from_date', in: 'query', schema: { type: 'string', format: 'date' } },
          { name: 'to_date', in: 'query', schema: { type: 'string', format: 'date' } },
        ],
        responses: { '200': { description: 'Invoices' }, '404': errorResponse },
      },
    },
    '/sites': {
      post: {
        summary: 'Create site',
        parameters: [idempotencyHeader],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/SiteInput' } } } },
        responses: { '201': { description: 'Created' }, '404': errorResponse, '422': errorResponse },
      },
    },
    '/sites/{site_reference}': {
      get: {
        summary: 'Get site',
        parameters: [{ $ref: '#/components/parameters/SiteReference' }],
        responses: { '200': { description: 'Site' }, '404': errorResponse },
      },
    },
    '/sites/{site_reference}/measurements': {
      get: {
        summary: 'Get consumption/production measurements',
        parameters: [
          { $ref: '#/components/parameters/SiteReference' },
          { name: 'from_date', in: 'query', required: true, schema: { type: 'string', format: 'date' } },
          { name: 'to_date', in: 'query', required: true, schema: { type: 'string', format: 'date' } },
          { name: 'resolution', in: 'query', schema: { type: 'string', enum: ['15m', '1h'], default: '1h' } },
        ],
        responses: { '200': { description: 'Measurements' }, '404': errorResponse, '422': errorResponse },
      },
    },
    '/powers-of-attorney': {
      post: {
        summary: 'Register signed power of attorney',
        parameters: [idempotencyHeader],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/PowerOfAttorneyInput' } } } },
        responses: { '201': { description: 'Created' }, '404': errorResponse, '409': errorResponse, '422': errorResponse },
      },
    },
    '/powers-of-attorney/{power_of_attorney_reference}': {
      get: {
        summary: 'Get power of attorney',
        parameters: [{
          name: 'power_of_attorney_reference',
          in: 'path',
          required: true,
          schema: { type: 'string' },
        }],
        responses: { '200': { description: 'Power of attorney' }, '404': errorResponse },
      },
    },
    '/invoices/{invoice_reference}': {
      get: {
        summary: 'Get invoice',
        parameters: [{ $ref: '#/components/parameters/InvoiceReference' }],
        responses: { '200': { description: 'Invoice' }, '404': errorResponse },
      },
    },
    '/invoices/{invoice_reference}/pdf': {
      get: {
        summary: 'Get authorized invoice PDF download URL',
        parameters: [{ $ref: '#/components/parameters/InvoiceReference' }],
        responses: { '200': { description: 'PDF download descriptor' }, '404': errorResponse },
      },
    },
    '/webhooks/subscriptions': {
      get: {
        summary: 'List webhook subscriptions for this API client',
        responses: { '200': { description: 'Subscriptions' } },
      },
      post: {
        summary: 'Create webhook subscription',
        parameters: [idempotencyHeader],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/WebhookSubscriptionInput' } } } },
        responses: { '201': { description: 'Created' }, '422': errorResponse },
      },
    },
    '/webhooks/subscriptions/{webhook_subscription_reference}': {
      delete: {
        summary: 'Delete webhook subscription',
        parameters: [{
          name: 'webhook_subscription_reference',
          in: 'path',
          required: true,
          schema: { type: 'string' },
        }],
        responses: { '200': { description: 'Deleted' }, '404': errorResponse },
      },
    },
  },
  components: {
    securitySchemes: {
      BearerAuth: {
        type: 'http',
        scheme: 'bearer',
        description: 'Server-side Gridex API key. Never expose this key in a browser or mobile application.',
      },
    },
    parameters: {
      ContractReference: {
        name: 'contract_reference',
        in: 'path',
        required: true,
        schema: { type: 'string' },
      },
      CustomerReference: {
        name: 'customer_reference',
        in: 'path',
        required: true,
        schema: { type: 'string' },
      },
      SiteReference: {
        name: 'site_reference',
        in: 'path',
        required: true,
        schema: { type: 'string' },
      },
      InvoiceReference: {
        name: 'invoice_reference',
        in: 'path',
        required: true,
        schema: { type: 'string' },
      },
    },
    schemas: {
      Address: {
        type: 'object',
        additionalProperties: false,
        required: ['street', 'postal_code', 'city'],
        properties: {
          street: { type: 'string' },
          postal_code: { type: 'string' },
          city: { type: 'string' },
          country: { type: 'string', default: 'SE' },
        },
      },
      CustomerInput: {
        type: 'object',
        additionalProperties: false,
        required: ['external_customer_id', 'type', 'email'],
        properties: {
          external_customer_id: { type: 'string', description: 'Stable reference from the partner system.' },
          type: { type: 'string', enum: ['private', 'business', 'association'] },
          first_name: { type: 'string' },
          last_name: { type: 'string' },
          company_name: { type: 'string' },
          identity_number: { type: 'string', description: 'Required for private customers.' },
          organization_number: { type: 'string', description: 'Required for business/association customers.' },
          email: { type: 'string', format: 'email' },
          phone: { type: 'string' },
          invoice_address: { $ref: '#/components/schemas/Address' },
          metadata: { type: 'object', additionalProperties: true },
        },
      },
      SiteInput: {
        type: 'object',
        additionalProperties: false,
        required: ['customer_reference', 'electricity_type', 'address'],
        properties: {
          customer_reference: { type: 'string' },
          name: { type: 'string' },
          electricity_type: { type: 'string', enum: ['consumption', 'production'] },
          facility_id: { type: 'string' },
          address: { $ref: '#/components/schemas/Address' },
          move_in_date: { type: 'string', format: 'date' },
          annual_consumption_kwh: { type: 'number', minimum: 0 },
        },
      },
      AgreementEvidence: {
        type: 'object',
        additionalProperties: false,
        properties: {
          accepted_at: { type: 'string', format: 'date-time' },
          signer_name: { type: 'string' },
          evidence_reference: { type: 'string' },
          distance_agreement: { type: 'boolean', default: true },
        },
        description: 'If accepted_at is sent, signer_name and evidence_reference are required. Without signed evidence the contract is created as pending_signature.',
      },
      PowerOfAttorneyInput: {
        type: 'object',
        additionalProperties: false,
        required: ['customer_reference', 'site_reference', 'accepted', 'signer_name', 'evidence_reference'],
        properties: {
          customer_reference: { type: 'string' },
          site_reference: { type: 'string' },
          contract_reference: { type: 'string' },
          accepted: { const: true },
          accepted_at: { type: 'string', format: 'date-time' },
          signer_name: { type: 'string' },
          signer_identity_number: { type: 'string' },
          poa_type: { type: 'string', enum: ['web', 'paper', 'audio'] },
          transaction_type: { type: 'string', enum: ['SWITCH', 'MOVE_OUT'] },
          evidence_reference: { type: 'string' },
          file_base64: { type: 'string', description: 'Optional PDF, maximum decoded size 5 MB.' },
          file_extension: { type: 'string', enum: ['pdf'] },
        },
      },
      CreateContractRequest: {
        type: 'object',
        additionalProperties: false,
        required: ['offer_reference', 'customer', 'site'],
        properties: {
          offer_reference: { type: 'string', description: 'Reference from the API-published offer catalogue.' },
          customer: { $ref: '#/components/schemas/CustomerInput' },
          site: {
            type: 'object',
            additionalProperties: false,
            required: ['electricity_type', 'address'],
            properties: {
              name: { type: 'string' },
              electricity_type: { type: 'string', enum: ['consumption', 'production'] },
              facility_id: { type: 'string' },
              address: { $ref: '#/components/schemas/Address' },
              move_in_date: { type: 'string', format: 'date' },
              annual_consumption_kwh: { type: 'number', minimum: 0 },
            },
          },
          agreement: { $ref: '#/components/schemas/AgreementEvidence' },
          power_of_attorney: {
            type: 'object',
            additionalProperties: false,
            required: ['accepted', 'signer_name', 'evidence_reference'],
            properties: {
              accepted: { const: true },
              accepted_at: { type: 'string', format: 'date-time' },
              signer_name: { type: 'string' },
              signer_identity_number: { type: 'string' },
              poa_type: { type: 'string', enum: ['web', 'paper', 'audio'] },
              transaction_type: { type: 'string', enum: ['SWITCH', 'MOVE_OUT'] },
              evidence_reference: { type: 'string' },
              file_base64: { type: 'string', description: 'Optional PDF, maximum decoded size 5 MB.' },
              file_extension: { type: 'string', enum: ['pdf'] },
            },
          },
          requested_start_date: { type: 'string', format: 'date' },
          requested_start_mode: { type: 'string', enum: ['earliest_possible', 'specific_date'], default: 'earliest_possible' },
          metadata: { type: 'object', additionalProperties: true },
        },
      },
      WebhookSubscriptionInput: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'endpoint_url', 'event_types', 'signing_secret'],
        properties: {
          name: { type: 'string' },
          endpoint_url: { type: 'string', format: 'uri', pattern: '^https://' },
          event_types: {
            type: 'array',
            minItems: 1,
            uniqueItems: true,
            items: {
              type: 'string',
              enum: ['contract.created', 'contract.status_changed', 'invoice.created', 'invoice.sent', 'metering_values.updated'],
            },
          },
          signing_secret: {
            type: 'string',
            minLength: 32,
            writeOnly: true,
            description: 'Partner-generated signing secret. Stored in Gridex Vault and never returned by the API.',
          },
          description: { type: 'string' },
        },
      },
      ErrorResponse: {
        type: 'object',
        required: ['error', 'request_id', 'api_version'],
        properties: {
          error: {
            type: 'object',
            required: ['code', 'message'],
            properties: {
              code: { type: 'string' },
              message: { type: 'string' },
              field: { type: 'string' },
            },
          },
          request_id: { type: 'string' },
          api_version: { type: 'string' },
        },
      },
    },
  },
} as const
