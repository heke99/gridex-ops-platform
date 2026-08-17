import { partnerOpenApi } from './openApi'

type JsonObject = Record<string, unknown>

const errorResponse = {
  description: 'Error',
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/ErrorResponse' },
    },
  },
}

const postalParameter = {
  name: 'postal_code',
  in: 'query',
  required: true,
  schema: { type: 'string', pattern: '^\\d{5}$', example: '21120' },
  description: 'Swedish five-digit postal code. Spaces are accepted and normalized by Gridex.',
}

const optionalLocationParameters = [
  {
    name: 'address',
    in: 'query',
    required: false,
    schema: { type: 'string', example: 'Storgatan 1' },
    description: 'Full street address. Required only when the postal code is ambiguous or not sufficient for a safe grid-owner match.',
  },
  {
    name: 'city',
    in: 'query',
    required: false,
    schema: { type: 'string', example: 'Malmö' },
  },
  {
    name: 'country',
    in: 'query',
    required: false,
    schema: { type: 'string', default: 'SE', example: 'SE' },
  },
]

const idempotencyHeader = {
  name: 'Idempotency-Key',
  in: 'header',
  required: true,
  schema: { type: 'string', minLength: 8, maxLength: 200 },
  description: 'Unique key for this price request. Reuse the same key only when retrying the same request.',
}

const components = partnerOpenApi.components as JsonObject
const schemas = (components.schemas ?? {}) as JsonObject
const existingPaths = partnerOpenApi.paths as JsonObject

export const partnerBusinessOpenApi = {
  ...partnerOpenApi,
  info: {
    ...partnerOpenApi.info,
    description:
      'Simple backend-to-backend API for electricity pricing, location/grid-owner resolution, contract registration, customer/site data, invoices, measurements and webhooks. Send business inputs only; Gridex resolves the company, published offer, electricity area, grid owner and pricing configuration internally.',
  },
  paths: {
    '/location': {
      get: {
        summary: 'Resolve electricity location',
        description: 'Resolve price area, grid area and grid owner. Start with postal_code; add address and city only when Gridex reports that the postal code is ambiguous.',
        parameters: [postalParameter, ...optionalLocationParameters],
        responses: {
          '200': { description: 'Location resolved', content: { 'application/json': { schema: { $ref: '#/components/schemas/LocationResponse' } } } },
          '400': errorResponse,
          '401': errorResponse,
          '403': errorResponse,
          '422': errorResponse,
        },
      },
    },
    '/price/current': {
      get: {
        summary: 'Get current electricity market price',
        description: 'Gridex resolves the correct SE price area from the location and returns the currently active normalized market-price interval.',
        parameters: [postalParameter, ...optionalLocationParameters],
        responses: {
          '200': { description: 'Current market price', content: { 'application/json': { schema: { $ref: '#/components/schemas/CurrentPriceResponse' } } } },
          '400': errorResponse,
          '401': errorResponse,
          '403': errorResponse,
          '409': errorResponse,
          '422': errorResponse,
          '503': errorResponse,
        },
      },
    },
    '/price': {
      post: {
        summary: 'Calculate the customer price',
        description: 'Gridex resolves the electricity area and the API credential’s published offer, then calls the same canonical pricing engine used by Gridex. Internal product, price-plan, grid-owner and publication IDs are never required.',
        parameters: [idempotencyHeader],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/PriceRequest' },
              examples: {
                minimal: {
                  value: {
                    postal_code: '21120',
                    annual_consumption_kwh: 3500,
                  },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Customer price calculated', content: { 'application/json': { schema: { $ref: '#/components/schemas/PriceResponse' } } } },
          '400': errorResponse,
          '401': errorResponse,
          '403': errorResponse,
          '409': errorResponse,
          '422': errorResponse,
          '503': errorResponse,
        },
      },
    },
    ...existingPaths,
  },
  components: {
    ...components,
    schemas: {
      ...schemas,
      PublicLocation: {
        type: 'object',
        required: ['postal_code', 'price_area', 'resolution'],
        properties: {
          postal_code: { type: 'string', example: '21120' },
          city: { type: ['string', 'null'] },
          price_area: { type: 'string', enum: ['SE1', 'SE2', 'SE3', 'SE4'] },
          grid_area: {
            anyOf: [
              { type: 'null' },
              {
                type: 'object',
                properties: { code: { type: 'string' }, name: { type: ['string', 'null'] } },
                required: ['code', 'name'],
                additionalProperties: false,
              },
            ],
          },
          grid_owner: {
            anyOf: [
              { type: 'null' },
              { type: 'object', properties: { name: { type: 'string' } }, required: ['name'], additionalProperties: false },
            ],
          },
          resolution: {
            type: 'object',
            properties: {
              status: { type: 'string', enum: ['resolved', 'pricing_ready', 'needs_address'] },
              confidence: { type: 'number', minimum: 0, maximum: 1 },
              source: { type: ['string', 'null'] },
              grid_owner_verified: { type: 'boolean' },
            },
            required: ['status', 'confidence', 'source', 'grid_owner_verified'],
            additionalProperties: false,
          },
        },
        additionalProperties: false,
      },
      LocationResponse: {
        allOf: [
          { $ref: '#/components/schemas/PublicLocation' },
          {
            type: 'object',
            properties: {
              request_id: { type: 'string' },
              api_version: { type: 'string' },
            },
            required: ['request_id', 'api_version'],
          },
        ],
      },
      PriceRequest: {
        type: 'object',
        required: ['postal_code', 'annual_consumption_kwh'],
        properties: {
          postal_code: { type: 'string', example: '21120' },
          address: { type: 'string', example: 'Storgatan 1' },
          city: { type: 'string', example: 'Malmö' },
          country: { type: 'string', default: 'SE' },
          annual_consumption_kwh: { type: 'number', exclusiveMinimum: 0, example: 3500 },
          customer_type: { type: 'string', enum: ['PRIVATE', 'COMPANY'], default: 'PRIVATE' },
          start_date: { type: 'string', format: 'date' },
        },
        additionalProperties: false,
      },
      CurrentPriceResponse: {
        type: 'object',
        required: ['location', 'market_price', 'request_id', 'api_version'],
        properties: {
          location: { $ref: '#/components/schemas/PublicLocation' },
          market_price: {
            type: 'object',
            properties: {
              value: { type: 'number' },
              currency: { type: 'string', const: 'SEK' },
              unit: { type: 'string', const: 'kWh' },
              includes_vat: { type: 'boolean', const: false },
              resolution: { type: 'string', enum: ['hourly', 'quarterly'] },
              valid_from: { type: 'string', format: 'date-time' },
              valid_to: { type: 'string', format: 'date-time' },
              source_as_of: { type: 'string', format: 'date-time' },
            },
            required: ['value', 'currency', 'unit', 'includes_vat', 'resolution', 'valid_from', 'valid_to', 'source_as_of'],
            additionalProperties: false,
          },
          request_id: { type: 'string' },
          api_version: { type: 'string' },
        },
        additionalProperties: false,
      },
      PriceResponse: {
        type: 'object',
        required: ['quote_reference', 'location', 'offer', 'customer_price', 'estimated_cost', 'price_components', 'is_binding', 'request_id', 'api_version'],
        properties: {
          quote_reference: { type: 'string' },
          valid_until: { type: 'string', format: 'date-time' },
          location: { $ref: '#/components/schemas/PublicLocation' },
          current_market_price: { anyOf: [{ type: 'null' }, { type: 'number' }] },
          offer: {
            type: 'object',
            properties: { name: { type: 'string' }, contract_type: { type: 'string' } },
            required: ['name', 'contract_type'],
            additionalProperties: false,
          },
          customer_price: {
            type: 'object',
            properties: {
              estimated_unit_price_inc_vat: { type: 'number' },
              currency: { type: 'string', const: 'SEK' },
              unit: { type: 'string', const: 'kWh' },
            },
            required: ['estimated_unit_price_inc_vat', 'currency', 'unit'],
            additionalProperties: false,
          },
          estimated_cost: {
            type: 'object',
            properties: { monthly_inc_vat: { type: 'number' }, annual_inc_vat: { type: 'number' } },
            required: ['monthly_inc_vat', 'annual_inc_vat'],
            additionalProperties: false,
          },
          price_components: { type: 'array', items: { type: 'object' } },
          is_binding: { type: 'boolean' },
          request_id: { type: 'string' },
          api_version: { type: 'string' },
        },
        additionalProperties: false,
      },
    },
  },
}
