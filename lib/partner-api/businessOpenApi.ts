import { partnerOpenApi } from './openApi'

const errorResponse = {
  description: 'Error',
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/ErrorResponse' },
    },
  },
}

const postalCodeParameter = {
  name: 'postal_code',
  in: 'query',
  required: true,
  schema: { type: 'string', pattern: '^\\d{5}$' },
  description: 'Swedish five-digit postal code.',
}

const addressParameter = {
  name: 'address',
  in: 'query',
  required: false,
  schema: { type: 'string' },
  description: 'Street address. Recommended and required when the postal code is ambiguous.',
}

const cityParameter = {
  name: 'city',
  in: 'query',
  required: false,
  schema: { type: 'string' },
  description: 'City. Recommended together with address.',
}

export const partnerPublicOpenApi = {
  ...partnerOpenApi,
  info: {
    ...partnerOpenApi.info,
    description:
      'Small backend-to-backend API for location resolution, electricity pricing, contract registration, customer/site data, invoices, measurements and change notifications. The API credential determines the company and Gridex resolves internal grid, market and product configuration server-side.',
  },
  paths: {
    '/location': {
      get: {
        summary: 'Resolve electricity location',
        description:
          'Resolves a Swedish postal code and optional address to price area, grid area and grid owner. A postal code that spans conflicting price areas is returned as ambiguous rather than guessed.',
        parameters: [postalCodeParameter, addressParameter, cityParameter],
        responses: {
          '200': {
            description: 'Location resolved',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/LocationResponse' } } },
          },
          '401': errorResponse,
          '403': errorResponse,
          '409': errorResponse,
          '422': errorResponse,
        },
      },
    },
    '/price/current': {
      get: {
        summary: 'Get current market electricity price',
        description:
          'Resolves the customer location and returns the current verified market-price interval from the same configured Gridex market-price source used internally.',
        parameters: [postalCodeParameter, addressParameter, cityParameter],
        responses: {
          '200': {
            description: 'Current market price',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/CurrentPriceResponse' } } },
          },
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
        summary: 'Calculate customer price',
        description:
          'Resolves location and the credential default offer, then calculates the quote with the same Gridex pricing engine used by Ops. Internal company, product, price-area, grid-owner and offer identifiers are never accepted.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/PriceRequest' },
            },
          },
        },
        responses: {
          '200': {
            description: 'Price calculated',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/PriceResponse' } } },
          },
          '400': errorResponse,
          '401': errorResponse,
          '403': errorResponse,
          '404': errorResponse,
          '409': errorResponse,
          '422': errorResponse,
        },
      },
    },
    ...partnerOpenApi.paths,
  },
  components: {
    ...partnerOpenApi.components,
    schemas: {
      ...partnerOpenApi.components.schemas,
      Location: {
        type: 'object',
        additionalProperties: false,
        required: [
          'postal_code', 'status', 'price_area', 'grid_area', 'grid_owner',
          'confidence', 'price_area_confidence', 'requires_address', 'required_fields',
        ],
        properties: {
          postal_code: { type: 'string', pattern: '^\\d{5}$' },
          city: { type: ['string', 'null'] },
          status: { type: 'string', enum: ['resolved', 'partial', 'ambiguous', 'unresolved'] },
          price_area: { type: ['string', 'null'], enum: ['SE1', 'SE2', 'SE3', 'SE4', null] },
          grid_area: {
            anyOf: [
              {
                type: 'object',
                additionalProperties: false,
                required: ['code', 'name', 'verified'],
                properties: {
                  code: { type: 'string' },
                  name: { type: ['string', 'null'] },
                  verified: { type: 'boolean' },
                },
              },
              { type: 'null' },
            ],
          },
          grid_owner: {
            anyOf: [
              {
                type: 'object',
                additionalProperties: false,
                required: ['name', 'verified'],
                properties: {
                  name: { type: 'string' },
                  verified: { type: 'boolean' },
                },
              },
              { type: 'null' },
            ],
          },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          price_area_confidence: { type: 'number', minimum: 0, maximum: 1 },
          resolution_method: { type: ['string', 'null'] },
          requires_address: { type: 'boolean' },
          required_fields: { type: 'array', items: { type: 'string' } },
          warnings: { type: 'array', items: { type: 'string' } },
        },
      },
      LocationResponse: {
        type: 'object',
        additionalProperties: false,
        required: ['location'],
        properties: { location: { $ref: '#/components/schemas/Location' } },
      },
      CurrentPriceResponse: {
        type: 'object',
        additionalProperties: false,
        required: ['location', 'market_price'],
        properties: {
          location: { $ref: '#/components/schemas/Location' },
          market_price: {
            type: 'object',
            additionalProperties: false,
            required: [
              'provider', 'price_area', 'resolution', 'available_resolutions',
              'valid_from', 'valid_to', 'price_sek_per_kwh_ex_vat',
              'price_ore_per_kwh_ex_vat', 'currency', 'includes_vat',
              'includes_supplier_fees', 'includes_grid_fees', 'source_as_of', 'next_update_at',
            ],
            properties: {
              provider: { type: 'string' },
              price_area: { type: 'string', enum: ['SE1', 'SE2', 'SE3', 'SE4'] },
              resolution: { type: 'string', enum: ['hourly', 'quarterly'] },
              available_resolutions: { type: 'array', items: { type: 'string', enum: ['hourly', 'quarterly'] } },
              valid_from: { type: 'string', format: 'date-time' },
              valid_to: { type: 'string', format: 'date-time' },
              price_sek_per_kwh_ex_vat: { type: 'number' },
              price_ore_per_kwh_ex_vat: { type: 'number' },
              currency: { type: 'string', const: 'SEK' },
              includes_vat: { type: 'boolean', const: false },
              includes_supplier_fees: { type: 'boolean', const: false },
              includes_grid_fees: { type: 'boolean', const: false },
              source_as_of: { type: 'string', format: 'date-time' },
              next_update_at: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
      PriceRequest: {
        type: 'object',
        additionalProperties: false,
        required: ['postal_code', 'annual_consumption_kwh'],
        properties: {
          postal_code: { type: 'string', pattern: '^\\d{5}$' },
          address: { type: 'string' },
          city: { type: 'string' },
          country: { type: 'string', default: 'SE' },
          annual_consumption_kwh: { type: 'number', exclusiveMinimum: 0 },
          customer_type: { type: 'string', enum: ['PRIVATE', 'COMPANY'], default: 'PRIVATE' },
          start_date: { type: 'string', format: 'date' },
          invoice_delivery_method: { type: 'string', enum: ['email', 'e_invoice', 'paper'] },
        },
        example: {
          postal_code: '11122',
          address: 'Exempelgatan 1',
          city: 'Stockholm',
          annual_consumption_kwh: 3500,
          customer_type: 'PRIVATE',
        },
      },
      PriceComponent: {
        type: 'object',
        additionalProperties: false,
        properties: {
          code: { type: ['string', 'null'] },
          name: { type: ['string', 'null'] },
          quantity: { type: ['number', 'null'] },
          unit: { type: ['string', 'null'] },
          unit_price_ex_vat: { type: ['number', 'null'] },
          amount_ex_vat: { type: ['number', 'null'] },
          vat_rate: { type: ['number', 'null'] },
          vat_amount: { type: ['number', 'null'] },
          amount_inc_vat: { type: ['number', 'null'] },
        },
      },
      PriceResponse: {
        type: 'object',
        additionalProperties: false,
        required: [
          'quote_reference', 'valid_until', 'location', 'offer', 'customer_price',
          'estimated_cost', 'price_components', 'is_binding', 'warnings', 'assumptions',
        ],
        properties: {
          quote_reference: { type: 'string' },
          valid_until: { type: 'string', format: 'date-time' },
          location: { $ref: '#/components/schemas/Location' },
          offer: {
            type: 'object',
            additionalProperties: false,
            required: ['name', 'code', 'contract_type'],
            properties: {
              name: { type: ['string', 'null'] },
              code: { type: ['string', 'null'] },
              contract_type: { type: ['string', 'null'] },
            },
          },
          customer_price: {
            type: 'object',
            additionalProperties: false,
            required: ['estimated_sek_per_kwh_inc_vat', 'currency', 'unit'],
            properties: {
              estimated_sek_per_kwh_inc_vat: { type: ['number', 'null'] },
              currency: { type: 'string', const: 'SEK' },
              unit: { type: 'string', const: 'kWh' },
            },
          },
          estimated_cost: {
            type: 'object',
            additionalProperties: false,
            required: [
              'monthly_ex_vat', 'monthly_vat', 'monthly_inc_vat',
              'annual_ex_vat', 'annual_vat', 'annual_inc_vat', 'currency',
            ],
            properties: {
              monthly_ex_vat: { type: ['number', 'null'] },
              monthly_vat: { type: ['number', 'null'] },
              monthly_inc_vat: { type: ['number', 'null'] },
              annual_ex_vat: { type: ['number', 'null'] },
              annual_vat: { type: ['number', 'null'] },
              annual_inc_vat: { type: ['number', 'null'] },
              currency: { type: 'string', const: 'SEK' },
            },
          },
          price_components: { type: 'array', items: { $ref: '#/components/schemas/PriceComponent' } },
          is_binding: { type: 'boolean', const: false },
          warnings: { type: 'array', items: { type: 'string' } },
          assumptions: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
} as const
