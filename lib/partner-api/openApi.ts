export const PARTNER_API_VERSION = '2026-08-17.1'
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
  description: 'Unique key for the business write. Reuse the same key only when retrying the same request.',
}

const customerId = { $ref: '#/components/parameters/CustomerId' }
const siteId = { $ref: '#/components/parameters/SiteId' }

export const partnerOpenApi = {
  openapi: '3.1.0',
  info: {
    title: 'Gridex Partner API',
    version: PARTNER_API_VERSION,
    description:
      'Small backend-to-backend API for contract registration, customer/site data, invoices, measurements and change notifications. Gridex configures the company, API credential, permissions and default published offer outside the API.',
  },
  servers: [{ url: PARTNER_API_BASE_URL }],
  security: [{ BearerAuth: [] }],
  paths: {
    '/contract': {
      post: {
        summary: 'Create contract',
        description: 'Combined registration. Creates the customer, site and contract in one transaction. A power of attorney may be included.',
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
          '201': {
            description: 'Contract created',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateContractResponse' } } },
          },
          '400': errorResponse,
          '401': errorResponse,
          '403': errorResponse,
          '409': errorResponse,
          '413': errorResponse,
          '422': errorResponse,
        },
      },
    },
    '/customer': {
      post: {
        summary: 'Create customer',
        parameters: [idempotencyHeader],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/CustomerInput' } } },
        },
        responses: {
          '201': { description: 'Customer created', content: { 'application/json': { schema: { $ref: '#/components/schemas/EntityResponse' } } } },
          '400': errorResponse,
          '401': errorResponse,
          '403': errorResponse,
          '409': errorResponse,
          '422': errorResponse,
        },
      },
    },
    '/customer/{customer_id}/site': {
      post: {
        summary: 'Create site',
        parameters: [customerId, idempotencyHeader],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/SiteInput' } } },
        },
        responses: {
          '201': { description: 'Site created', content: { 'application/json': { schema: { $ref: '#/components/schemas/EntityResponse' } } } },
          '400': errorResponse,
          '401': errorResponse,
          '403': errorResponse,
          '404': errorResponse,
          '409': errorResponse,
          '422': errorResponse,
        },
      },
    },
    '/customer/{customer_id}/site/{site_id}/powerofattorney': {
      post: {
        summary: 'Upload power of attorney',
        parameters: [customerId, siteId, idempotencyHeader],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/PowerOfAttorneyInput' } } },
        },
        responses: {
          '201': { description: 'Power of attorney created', content: { 'application/json': { schema: { $ref: '#/components/schemas/EntityResponse' } } } },
          '400': errorResponse,
          '401': errorResponse,
          '403': errorResponse,
          '404': errorResponse,
          '409': errorResponse,
          '413': errorResponse,
          '422': errorResponse,
        },
      },
      get: {
        summary: 'Get power of attorney',
        parameters: [customerId, siteId],
        responses: {
          '200': { description: 'Power of attorney', content: { 'application/json': { schema: { $ref: '#/components/schemas/PowerOfAttorney' } } } },
          '401': errorResponse,
          '403': errorResponse,
          '404': errorResponse,
        },
      },
    },
    '/contract/{contract_id}/state': {
      get: {
        summary: 'Get contract state',
        parameters: [{ $ref: '#/components/parameters/ContractId' }],
        responses: {
          '200': { description: 'Contract state', content: { 'application/json': { schema: { $ref: '#/components/schemas/ContractState' } } } },
          '401': errorResponse,
          '403': errorResponse,
          '404': errorResponse,
        },
      },
    },
    '/customer/{customer_id}': {
      get: {
        summary: 'Get customer',
        parameters: [customerId],
        responses: {
          '200': { description: 'Customer', content: { 'application/json': { schema: { $ref: '#/components/schemas/Customer' } } } },
          '401': errorResponse,
          '403': errorResponse,
          '404': errorResponse,
        },
      },
    },
    '/customer/{customer_id}/site/{site_id}': {
      get: {
        summary: 'Get site',
        parameters: [customerId, siteId],
        responses: {
          '200': { description: 'Site', content: { 'application/json': { schema: { $ref: '#/components/schemas/Site' } } } },
          '401': errorResponse,
          '403': errorResponse,
          '404': errorResponse,
        },
      },
    },
    '/customer/{customer_id}/site/{site_id}/invoice': {
      get: {
        summary: 'List invoices for site',
        parameters: [
          customerId,
          siteId,
          { name: 'from_date', in: 'query', schema: { type: 'string', format: 'date' } },
          { name: 'to_date', in: 'query', schema: { type: 'string', format: 'date' } },
        ],
        responses: {
          '200': { description: 'Invoices', content: { 'application/json': { schema: { $ref: '#/components/schemas/InvoiceList' } } } },
          '401': errorResponse,
          '403': errorResponse,
          '404': errorResponse,
          '422': errorResponse,
        },
      },
    },
    '/invoice/{invoice_id}': {
      get: {
        summary: 'Get invoice',
        parameters: [{ $ref: '#/components/parameters/InvoiceId' }],
        responses: {
          '200': { description: 'Invoice', content: { 'application/json': { schema: { $ref: '#/components/schemas/Invoice' } } } },
          '401': errorResponse,
          '403': errorResponse,
          '404': errorResponse,
        },
      },
    },
    '/invoice/{invoice_id}/pdf': {
      get: {
        summary: 'Get invoice PDF',
        parameters: [{ $ref: '#/components/parameters/InvoiceId' }],
        responses: {
          '200': { description: 'Invoice PDF', content: { 'application/json': { schema: { $ref: '#/components/schemas/PdfDocument' } } } },
          '401': errorResponse,
          '403': errorResponse,
          '404': errorResponse,
          '413': errorResponse,
        },
      },
    },
    '/customer/{customer_id}/site/{site_id}/measurement': {
      get: {
        summary: 'Get measurements',
        parameters: [
          customerId,
          siteId,
          { name: 'from_date', in: 'query', required: true, schema: { type: 'string', format: 'date' } },
          { name: 'to_date', in: 'query', required: true, schema: { type: 'string', format: 'date' } },
          { name: 'resolution', in: 'query', schema: { type: 'string', enum: ['15m', '1h'], default: '1h' } },
        ],
        responses: {
          '200': { description: 'Measurements', content: { 'application/json': { schema: { $ref: '#/components/schemas/MeasurementResponse' } } } },
          '401': errorResponse,
          '403': errorResponse,
          '404': errorResponse,
          '422': errorResponse,
        },
      },
    },
    '/webhook/subscription': {
      post: {
        summary: 'Create webhook subscription',
        description: 'Registers one event subscription. target_url must be a public HTTPS endpoint. The signing secret is supplied by the partner and stored in Gridex Vault.',
        parameters: [idempotencyHeader],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/WebhookSubscriptionInput' } } },
        },
        responses: {
          '201': { description: 'Webhook subscription created', content: { 'application/json': { schema: { $ref: '#/components/schemas/EntityResponse' } } } },
          '400': errorResponse,
          '401': errorResponse,
          '403': errorResponse,
          '409': errorResponse,
          '422': errorResponse,
        },
      },
    },
  },
  webhooks: {
    resourceChanged: {
      post: {
        summary: 'Signed change notification',
        description: 'Treat the webhook as a signal. Verify the HMAC-SHA256 signature, then call the relevant GET endpoint for current state.',
        security: [],
        parameters: [
          { name: 'x-gridex-timestamp', in: 'header', required: true, schema: { type: 'string' } },
          { name: 'x-gridex-signature', in: 'header', required: true, schema: { type: 'string', pattern: '^sha256=' } },
          { name: 'x-gridex-event-id', in: 'header', required: true, schema: { type: 'string' } },
          { name: 'x-gridex-delivery-id', in: 'header', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/WebhookNotification' } } },
        },
        responses: { '200': { description: 'Receiver accepted the notification' } },
      },
    },
  },
  components: {
    securitySchemes: {
      BearerAuth: {
        type: 'http',
        scheme: 'bearer',
        description: 'Server-side Gridex API key. Never expose it in a browser or mobile application.',
      },
    },
    parameters: {
      CustomerId: { name: 'customer_id', in: 'path', required: true, schema: { type: 'string' }, description: 'Opaque entity_id returned by the Partner API.' },
      SiteId: { name: 'site_id', in: 'path', required: true, schema: { type: 'string' }, description: 'Opaque entity_id returned by the Partner API.' },
      ContractId: { name: 'contract_id', in: 'path', required: true, schema: { type: 'string' }, description: 'Opaque entity_id returned by the Partner API.' },
      InvoiceId: { name: 'invoice_id', in: 'path', required: true, schema: { type: 'string' }, description: 'Opaque entity_id returned by the Partner API.' },
    },
    schemas: {
      EntityResponse: {
        type: 'object',
        additionalProperties: false,
        required: ['entity_id'],
        properties: { entity_id: { type: 'string' } },
      },
      CustomerInput: {
        type: 'object',
        additionalProperties: false,
        required: ['soc_id', 'customer_type', 'email'],
        properties: {
          first_name: { type: 'string' },
          last_name: { type: 'string' },
          soc_id: { type: 'string', description: 'Personal identity number for PRIVATE or organisation number for COMPANY.' },
          customer_type: { type: 'string', enum: ['PRIVATE', 'COMPANY'] },
          company_name: { type: 'string' },
          invoice_address: { type: 'string' },
          zip_code: { type: 'string' },
          city: { type: 'string' },
          country: { type: 'string', default: 'SE' },
          email: { type: 'string', format: 'email' },
          cell_phone: { type: 'string' },
        },
      },
      Customer: {
        allOf: [
          { $ref: '#/components/schemas/CustomerInput' },
          { $ref: '#/components/schemas/EntityResponse' },
        ],
      },
      SiteInput: {
        type: 'object',
        additionalProperties: false,
        required: ['address', 'zip_code', 'city', 'site_electricity_type'],
        properties: {
          address: { type: 'string' },
          zip_code: { type: 'string' },
          city: { type: 'string' },
          country: { type: 'string', default: 'SE' },
          site_electricity_type: { type: 'string', enum: ['CONSUMPTION', 'PRODUCTION'] },
        },
      },
      Site: {
        allOf: [
          { $ref: '#/components/schemas/SiteInput' },
          { $ref: '#/components/schemas/EntityResponse' },
        ],
      },
      PowerOfAttorneyInput: {
        type: 'object',
        additionalProperties: false,
        required: ['poa_type', 'transaction_type', 'file_base64', 'file_extension'],
        properties: {
          poa_type: { type: 'string', enum: ['WEB', 'PAPER', 'AUDIO'] },
          transaction_type: { type: 'string', enum: ['SWITCH', 'MOVE_OUT'] },
          file_base64: { type: 'string', description: 'Signed PDF encoded as base64. Maximum decoded size 5 MB.' },
          file_extension: { type: 'string', enum: ['pdf'] },
        },
      },
      PowerOfAttorney: {
        type: 'object',
        additionalProperties: false,
        required: ['entity_id', 'poa_type', 'transaction_type', 'file_base64', 'file_extension'],
        properties: {
          entity_id: { type: 'string' },
          poa_type: { type: 'string', enum: ['WEB', 'PAPER', 'AUDIO'] },
          transaction_type: { type: 'string', enum: ['SWITCH', 'MOVE_OUT'] },
          file_base64: { type: ['string', 'null'] },
          file_extension: { type: ['string', 'null'] },
        },
      },
      CreateContractRequest: {
        type: 'object',
        additionalProperties: false,
        required: ['customer', 'site'],
        properties: {
          customer: { $ref: '#/components/schemas/CustomerInput' },
          site: { $ref: '#/components/schemas/SiteInput' },
          power_of_attorney: { $ref: '#/components/schemas/PowerOfAttorneyInput' },
        },
      },
      CreateContractResponse: {
        type: 'object',
        additionalProperties: false,
        required: ['entity_id', 'customer', 'site', 'power_of_attorney'],
        properties: {
          entity_id: { type: 'string' },
          customer: { $ref: '#/components/schemas/EntityResponse' },
          site: { $ref: '#/components/schemas/EntityResponse' },
          power_of_attorney: { anyOf: [{ $ref: '#/components/schemas/EntityResponse' }, { type: 'null' }] },
        },
      },
      ContractState: {
        type: 'object',
        additionalProperties: false,
        required: ['entity_id', 'state'],
        properties: { entity_id: { type: 'string' }, state: { type: 'string' } },
      },
      Invoice: {
        type: 'object',
        additionalProperties: false,
        required: ['entity_id', 'invoice_number', 'invoice_date', 'due_date', 'amount', 'currency', 'status'],
        properties: {
          entity_id: { type: 'string' },
          invoice_number: { type: ['string', 'null'] },
          invoice_date: { type: ['string', 'null'], format: 'date' },
          due_date: { type: ['string', 'null'], format: 'date' },
          amount: { type: ['number', 'null'] },
          currency: { type: ['string', 'null'], default: 'SEK' },
          status: { type: ['string', 'null'] },
        },
      },
      InvoiceList: {
        type: 'object',
        additionalProperties: false,
        required: ['invoices'],
        properties: { invoices: { type: 'array', items: { $ref: '#/components/schemas/Invoice' } } },
      },
      PdfDocument: {
        type: 'object',
        additionalProperties: false,
        required: ['entity_id', 'file_base64', 'file_extension'],
        properties: {
          entity_id: { type: 'string' },
          file_base64: { type: 'string' },
          file_extension: { type: 'string', const: 'pdf' },
        },
      },
      Measurement: {
        type: 'object',
        additionalProperties: false,
        required: ['timestamp', 'value', 'unit', 'type'],
        properties: {
          timestamp: { type: 'string', format: 'date-time' },
          value: { type: ['number', 'null'] },
          unit: { type: 'string', const: 'kWh' },
          type: { type: 'string', enum: ['CONSUMPTION', 'PRODUCTION'] },
        },
      },
      MeasurementResponse: {
        type: 'object',
        additionalProperties: false,
        required: ['site_id', 'measurements'],
        properties: {
          site_id: { type: 'string' },
          measurements: { type: 'array', items: { $ref: '#/components/schemas/Measurement' } },
        },
      },
      WebhookSubscriptionInput: {
        type: 'object',
        additionalProperties: false,
        required: ['webhook_event', 'target_url', 'signing_secret'],
        properties: {
          webhook_event: {
            type: 'string',
            enum: [
              'CUSTOMER_CREATED',
              'CUSTOMER_UPDATED',
              'SITE_CREATED',
              'SITE_UPDATED',
              'POWER_OF_ATTORNEY_CREATED',
              'CONTRACT_CREATED',
              'CONTRACT_STATUS_CHANGE',
              'INVOICE_CREATED',
              'INVOICE_UPDATED',
            ],
          },
          target_url: { type: 'string', format: 'uri', pattern: '^https://' },
          notification_email: { type: 'string', format: 'email' },
          signing_secret: { type: 'string', minLength: 32, writeOnly: true },
        },
      },
      WebhookNotification: {
        type: 'object',
        required: ['event_id', 'event_type', 'created_at', 'resource', 'data', 'api_version', 'delivery_id'],
        properties: {
          event_id: { type: 'string' },
          event_type: { type: 'string' },
          created_at: { type: 'string', format: 'date-time' },
          resource: {
            type: 'object',
            required: ['type', 'reference'],
            properties: { type: { type: 'string' }, reference: { type: 'string' } },
          },
          data: { type: 'object', additionalProperties: true },
          api_version: { type: 'string' },
          delivery_id: { type: 'string' },
        },
        additionalProperties: true,
      },
      ErrorResponse: {
        type: 'object',
        required: ['error', 'request_id'],
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
        },
      },
    },
  },
} as const
