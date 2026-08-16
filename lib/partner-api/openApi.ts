export const PARTNER_API_VERSION = '2026-08-16.2'
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
  description: 'Stable unique key for this business write. Reuse it only for an identical retry.',
}

const customerReference = { $ref: '#/components/parameters/CustomerReference' }
const siteReference = { $ref: '#/components/parameters/SiteReference' }

export const partnerOpenApi = {
  openapi: '3.1.0',
  info: {
    title: 'Gridex Partner API',
    version: PARTNER_API_VERSION,
    description:
      'Simple backend-to-backend API for electricity suppliers and integration partners. Gridex manages company onboarding, tenant configuration, API credentials, products and market configuration outside this API. The public API exposes only business resources: contracts, customers, sites, powers of attorney, invoices, measurements and webhook notifications.',
  },
  servers: [{ url: PARTNER_API_BASE_URL }],
  security: [{ BearerAuth: [] }],
  paths: {
    '/contract': {
      post: {
        summary: 'Register contract',
        description: 'Recommended combined flow. Registers customer, site and contract in one transaction and may include signed power-of-attorney evidence.',
        parameters: [idempotencyHeader],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CreateContractRequest' },
            },
          },
        },
        responses: {
          '201': { description: 'Contract registered' },
          '400': errorResponse,
          '401': errorResponse,
          '403': errorResponse,
          '409': errorResponse,
          '422': errorResponse,
        },
      },
    },
    '/contract/{contract_reference}': {
      get: {
        summary: 'Get contract',
        parameters: [{ $ref: '#/components/parameters/ContractReference' }],
        responses: { '200': { description: 'Contract' }, '401': errorResponse, '403': errorResponse, '404': errorResponse },
      },
    },
    '/contract/{contract_reference}/state': {
      get: {
        summary: 'Get contract state',
        parameters: [{ $ref: '#/components/parameters/ContractReference' }],
        responses: { '200': { description: 'Current contract state' }, '401': errorResponse, '403': errorResponse, '404': errorResponse },
      },
    },
    '/customer': {
      post: {
        summary: 'Create customer',
        parameters: [idempotencyHeader],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/CustomerInput' } } } },
        responses: { '201': { description: 'Customer created' }, '401': errorResponse, '403': errorResponse, '409': errorResponse, '422': errorResponse },
      },
    },
    '/customer/{customer_reference}': {
      get: {
        summary: 'Get customer',
        parameters: [customerReference],
        responses: { '200': { description: 'Customer' }, '401': errorResponse, '403': errorResponse, '404': errorResponse },
      },
    },
    '/customer/{customer_reference}/site': {
      post: {
        summary: 'Create site for customer',
        parameters: [customerReference, idempotencyHeader],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/SiteInput' } } } },
        responses: { '201': { description: 'Site created' }, '401': errorResponse, '403': errorResponse, '404': errorResponse, '409': errorResponse, '422': errorResponse },
      },
    },
    '/customer/{customer_reference}/site/{site_reference}': {
      get: {
        summary: 'Get site',
        parameters: [customerReference, siteReference],
        responses: { '200': { description: 'Site' }, '401': errorResponse, '403': errorResponse, '404': errorResponse },
      },
    },
    '/customer/{customer_reference}/site/{site_reference}/powerofattorney': {
      post: {
        summary: 'Register signed power of attorney',
        parameters: [customerReference, siteReference, idempotencyHeader],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/PowerOfAttorneyInput' } } } },
        responses: { '201': { description: 'Power of attorney registered' }, '401': errorResponse, '403': errorResponse, '404': errorResponse, '409': errorResponse, '422': errorResponse },
      },
      get: {
        summary: 'Get latest power of attorney for site',
        parameters: [customerReference, siteReference],
        responses: { '200': { description: 'Power of attorney' }, '401': errorResponse, '403': errorResponse, '404': errorResponse },
      },
    },
    '/customer/{customer_reference}/site/{site_reference}/invoice': {
      get: {
        summary: 'List invoices for site',
        parameters: [
          customerReference,
          siteReference,
          { name: 'from_date', in: 'query', schema: { type: 'string', format: 'date' } },
          { name: 'to_date', in: 'query', schema: { type: 'string', format: 'date' } },
        ],
        responses: { '200': { description: 'Invoices' }, '401': errorResponse, '403': errorResponse, '404': errorResponse },
      },
    },
    '/invoice/{invoice_reference}': {
      get: {
        summary: 'Get invoice',
        parameters: [{ $ref: '#/components/parameters/InvoiceReference' }],
        responses: { '200': { description: 'Invoice' }, '401': errorResponse, '403': errorResponse, '404': errorResponse },
      },
    },
    '/invoice/{invoice_reference}/pdf': {
      get: {
        summary: 'Get authorized invoice PDF download descriptor',
        parameters: [{ $ref: '#/components/parameters/InvoiceReference' }],
        responses: { '200': { description: 'PDF download descriptor' }, '401': errorResponse, '403': errorResponse, '404': errorResponse },
      },
    },
    '/customer/{customer_reference}/site/{site_reference}/measurement': {
      get: {
        summary: 'Get site measurements',
        parameters: [
          customerReference,
          siteReference,
          { name: 'from_date', in: 'query', required: true, schema: { type: 'string', format: 'date' } },
          { name: 'to_date', in: 'query', required: true, schema: { type: 'string', format: 'date' } },
          { name: 'resolution', in: 'query', schema: { type: 'string', enum: ['15m', '1h'], default: '1h' } },
        ],
        responses: { '200': { description: 'Measurements' }, '401': errorResponse, '403': errorResponse, '404': errorResponse, '422': errorResponse },
      },
    },
    '/webhook/subscription': {
      get: {
        summary: 'List webhook subscriptions for this API client',
        responses: { '200': { description: 'Webhook subscriptions' }, '401': errorResponse, '403': errorResponse },
      },
      post: {
        summary: 'Create webhook subscription',
        parameters: [idempotencyHeader],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/WebhookSubscriptionInput' } } } },
        responses: { '201': { description: 'Webhook subscription created' }, '401': errorResponse, '403': errorResponse, '409': errorResponse, '422': errorResponse },
      },
    },
    '/webhook/subscription/{webhook_subscription_reference}': {
      delete: {
        summary: 'Delete webhook subscription',
        parameters: [{ $ref: '#/components/parameters/WebhookSubscriptionReference' }],
        responses: { '200': { description: 'Deleted' }, '401': errorResponse, '403': errorResponse, '404': errorResponse },
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
      ContractReference: { name: 'contract_reference', in: 'path', required: true, schema: { type: 'string' } },
      CustomerReference: { name: 'customer_reference', in: 'path', required: true, schema: { type: 'string' } },
      SiteReference: { name: 'site_reference', in: 'path', required: true, schema: { type: 'string' } },
      InvoiceReference: { name: 'invoice_reference', in: 'path', required: true, schema: { type: 'string' } },
      WebhookSubscriptionReference: { name: 'webhook_subscription_reference', in: 'path', required: true, schema: { type: 'string' } },
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
          organization_number: { type: 'string', description: 'Required for business or association customers.' },
          email: { type: 'string', format: 'email' },
          phone: { type: 'string' },
          invoice_address: { $ref: '#/components/schemas/Address' },
          metadata: { type: 'object', additionalProperties: true },
        },
      },
      SiteInput: {
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
        required: ['accepted', 'signer_name', 'evidence_reference'],
        properties: {
          contract_reference: { type: 'string' },
          accepted: { const: true },
          accepted_at: { type: 'string', format: 'date-time' },
          signer_name: { type: 'string' },
          signer_identity_number: { type: 'string' },
          poa_type: { type: 'string', enum: ['web', 'paper', 'audio'] },
          transaction_type: { type: 'string', enum: ['SWITCH', 'MOVE_OUT'] },
          evidence_reference: { type: 'string' },
          file_base64: { type: 'string', description: 'Optional PDF. Maximum decoded size 5 MB.' },
          file_extension: { type: 'string', enum: ['pdf'] },
        },
      },
      CreateContractRequest: {
        type: 'object',
        additionalProperties: false,
        required: ['offer_reference', 'customer', 'site'],
        properties: {
          offer_reference: { type: 'string', description: 'Stable reference for an API-published Gridex product.' },
          customer: { $ref: '#/components/schemas/CustomerInput' },
          site: { $ref: '#/components/schemas/SiteInput' },
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
              file_base64: { type: 'string', description: 'Optional PDF. Maximum decoded size 5 MB.' },
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
              enum: [
                'customer.created',
                'customer.updated',
                'site.created',
                'site.updated',
                'power_of_attorney.created',
                'contract.created',
                'contract.status_changed',
                'invoice.created',
                'invoice.updated',
              ],
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
