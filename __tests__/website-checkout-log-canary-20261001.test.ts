import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { redirect } from 'next/navigation';
import { inspect } from 'node:util';
import { ApplicationSchema, validateNestedPayloadFields } from '@/lib/website/customerApplicationSchemas';
import { WEBSITE_CHECKOUT_REQUIRED_SCOPES, CUSTOMER_PORTAL_REQUIRED_SCOPES, TENANT_WEBSITE_RECOMMENDED_SCOPES } from '@/lib/integrations/websiteIntegrationContract';
type Row = Record<string, unknown>;
const f = vi.hoisted(() => ({
    allowed: true, hasToken: true, authCode: 'api_scope_missing', authStatus: 'active', blocked: false, useActualProcess: false,
    rpc: vi.fn(), quote: vi.fn(), validate: vi.fn(), offer: vi.fn(), process: vi.fn(), automation: vi.fn(), operation: vi.fn(), usage: vi.fn(),
    tables: {} as Record<string, Row[]>, queries: [] as string[], telemetry: [] as Row[]
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/platform/schemaReadiness', () => ({ assertPlatformSchemaReady: async () => undefined }));
vi.mock('@/lib/supabase/service', () => ({
    supabaseService: {
        rpc: f.rpc, from(table: string) {
            f.queries.push(table);
            const predicates: Array<(r: Row) => boolean> = [];
            let insert: Row | null = null, update: Row | null = null, single = false, head = false;
            const q = {
                select: (_fields?: string, options?: {
                    head?: boolean;
                }) => { head = options?.head === true; return q; },
                eq: (key: string, value: unknown) => { predicates.push(r => r[key] === value); return q; }, order: () => q, limit: () => q,
                insert: (value: Row) => { insert = structuredClone(value); return q; }, update: (value: Row) => { update = structuredClone(value); return q; },
                maybeSingle: () => { single = true; return q; }, single: () => { single = true; return q; },
                then: (resolve: (value: unknown) => unknown) => {
                    const all = f.tables[table] ?? [];
                    if (insert) {
                        insert = { id: '00000000-0000-4000-8000-000000000091', ...insert };
                        all.push(insert);
                        f.tables[table] = all;
                        if (table === 'integration_api_requests')
                            f.telemetry.push(insert);
                    }
                    const rows = insert ? [insert] : all.filter(row => predicates.every(p => p(row)));
                    if (update)
                        rows.forEach(row => Object.assign(row, update));
                    return Promise.resolve({ data: head ? null : structuredClone(single ? rows[0] ?? null : rows), count: rows.length, error: null }).then(resolve);
                }
            };
            return q;
        }
    }
}));
vi.mock('@/lib/integrations/tenantContext', () => ({ loadExternalTenantContext: async () => ({ tenant_reference: 'synthetic-public-company' }) }));
vi.mock('@/lib/website/publicContracts', async (original) => ({ ...await original<typeof import('@/lib/website/publicContracts')>(), resolvePublicContractOffer: f.offer }));
vi.mock('@/lib/pricing/offerQuote', async (original) => ({ ...await original<typeof import('@/lib/pricing/offerQuote')>(), calculateOfferQuote: f.quote }));
vi.mock('@/lib/pricing/websiteQuotes', async (original) => ({ ...await original<typeof import('@/lib/pricing/websiteQuotes')>(), validateWebsiteQuote: f.validate }));
vi.mock('@/lib/website/customerApplications', async (original) => {
    const actual = await original<typeof import('@/lib/website/customerApplications')>();
    return {
        ...actual, processWebsiteCustomerApplication: (input: Parameters<typeof actual.processWebsiteCustomerApplication>[0]) => f.useActualProcess ? actual.processWebsiteCustomerApplication(input) : f.process(input)
    };
});
vi.mock('@/lib/website/customerApplicationAutomationReadiness', () => ({ evaluateCustomerApplicationAutomationReadiness: f.automation }));
vi.mock('@/lib/tenant/operationPolicy', async (original) => ({ ...await original<typeof import('@/lib/tenant/operationPolicy')>(), getTenantOperationDecision: f.operation }));
vi.mock('@/lib/audit/actionLogger', () => ({ scheduleUsageEvent: f.usage, logAction: vi.fn() }));
import { POST as quote } from '@/app/api/v1/website/quote/route';
import { POST as validate } from '@/app/api/v1/website/quote/validate/route';
import { POST as application } from '@/app/api/v1/website/customer-applications/route';
import { OfferQuoteError } from '@/lib/pricing/offerQuote';
import { WebsiteQuoteValidationError } from '@/lib/pricing/websiteQuotes';
const companyId = '00000000-0000-4000-8000-000000000083', clientId = '00000000-0000-4000-8000-000000000084';
const token = 'synthetic-checkout-current-api-client-token';
const canaries = ['checkout-canary@example.invalid', '+46 70 123 45 67', 'Checkout Canary Fullname', 'Checkout Canary Street 31',
    'capway_api_key_canary_checkout_123456', 'sb_secret_canary_checkout_123456'];
const raw = canaries.join(' | ');
const commercial = {
    offer_reference: 'SYNTHETIC-OFFER', customer_type: 'private', resolution_id: '00000000-0000-4000-8000-000000000081',
    annual_consumption_kwh: 1000, start_date: '2026-10-15', price_option_reference: 'canonical_variable_monthly', invoice_delivery_method: 'email',
    selected_component_references: [], site_count: 1
};
const appBody = {
    ...commercial, customer_type: undefined, quote_reference: 'SYNTHETIC-QUOTE', external_customer_id: 'synthetic-external-customer',
    customer: { customer_type: 'private', email: canaries[0], first_name: 'Synthetic', last_name: 'Customer', phone: canaries[1] },
    site: { facility_id: '123456789012345678', street: 'Synthetic Street 1', postal_code: '12345', city: 'Synthetic City', country: 'SE' },
    legal_bundle_version: 'synthetic-legal-version', legal_acceptances: [{
            requirement_code: 'terms', document_reference: 'synthetic-document-reference-0001',
            document_version: '1', document_hash: 'a'.repeat(64), accepted: true, accepted_at: '2026-10-01T00:00:00Z'
        }],
    settlement: {
        model: 'market_hourly', customer_accepts: 'pricing_model', energy_price_locked_at_signup: false,
        uses_actual_metered_consumption: true, market_data_role: 'indicative_preview_only', settlement_resolution: 'hour'
    }
};
function request(path: string, body: Row) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'Origin': 'https://synthetic.invalid', 'Idempotency-Key': 'synthetic-checkout-write-key-20261001' };
    if (f.hasToken)
        headers.Authorization = `Bearer ${token}`;
    return new NextRequest('http://localhost' + path, { method: 'POST', headers, body: JSON.stringify(body) });
}
const routes = [
    { name: 'quote', path: '/api/v1/website/quote', post: quote, body: commercial, loader: f.quote, scope: 'website_quotes.write', code: 'website_quote_failed' },
    { name: 'quote/validate', path: '/api/v1/website/quote/validate', post: validate, body: { ...commercial, quote_reference: 'SYNTHETIC-QUOTE' }, loader: f.validate, scope: 'website_quotes.validate', code: 'website_quote_validation_failed' },
    { name: 'customer-applications', path: '/api/v1/website/customer-applications', post: application, body: appBody, loader: f.process, scope: 'website_applications.write', code: 'website_application_failed' },
];
let errorLog: ReturnType<typeof vi.spyOn>, warnLog: ReturnType<typeof vi.spyOn>, infoLog: ReturnType<typeof vi.spyOn>;
const absent = (value: unknown) => { for (const canary of [...canaries, token])
    expect(inspect(value, { depth: 14 })).not.toContain(canary); };
const noBusiness = () => {
    expect(f.quote).not.toHaveBeenCalled();
    expect(f.validate).not.toHaveBeenCalled();
    expect(f.offer).not.toHaveBeenCalled();
    expect(f.process).not.toHaveBeenCalled();
    expect(f.operation).not.toHaveBeenCalled();
    expect(f.automation).not.toHaveBeenCalled();
    expect(f.tables.integration_api_write_idempotency).toHaveLength(1);
};
beforeEach(() => {
    vi.clearAllMocks();
    f.allowed = true;
    f.hasToken = true;
    f.authCode = 'api_scope_missing';
    f.authStatus = 'active';
    f.blocked = false;
    f.useActualProcess = false;
    f.queries = [];
    f.telemetry = [];
    const scopes = [...new Set([...WEBSITE_CHECKOUT_REQUIRED_SCOPES, ...CUSTOMER_PORTAL_REQUIRED_SCOPES, ...TENANT_WEBSITE_RECOMMENDED_SCOPES, ...routes.map(r => r.scope)])];
    f.rpc.mockImplementation(async (name: string) => {
        expect(name).toBe('authenticate_integration_request_v1');
        return {
            data: [{
                    auth_outcome: f.allowed ? 'allowed' : 'denied', error_code: f.allowed ? null : f.authCode, tenant_status: f.authStatus,
                    client_id: clientId, company_id: companyId, client_name: 'Synthetic client', client_status: 'active', key_prefix: token.slice(0, 12), secret_hash: 'synthetic-hash',
                    scopes, allowed_ips: [], allowed_origins: ['https://synthetic.invalid'], metadata: {}, rate_limit_per_minute: 60, expires_at: null,
                    request_count: 1, route_limit: 60, reset_at: new Date(Date.now() + 60000).toISOString()
                }], error: null
        };
    });
    f.tables = {
        companies: [{
                id: companyId, status: 'active', external_tenant_reference: 'synthetic-company', customer_portal_url: 'https://synthetic.invalid/portal',
                branding: { unnecessary_customer_data: raw }, metadata: { website_portal_identity_mode: 'post_auth_allowed', unused_provider_secret: raw }
            }],
        tenant_website_readiness_v: [{
                company_id: companyId, has_public_contracts: true, has_terms: true, has_privacy_policy: true, has_withdrawal: true,
                has_power_of_attorney_text: true, has_price_terms: true, has_verified_sender: true, has_mail_templates: true
            }], webhook_subscriptions: [],
        integration_api_write_idempotency: [{ id: 'foreign-original', company_id: 'foreign', status: 'completed', request_hash: 'original-hash', response_body: { original: 'immutable' } }]
    };
    f.automation.mockResolvedValue({
        checks: {
            verified_customer_email_sender: true, required_email_templates_active: true, required_email_rules_active: true,
            automation_user_configured: true, automation_user_verified: true, cron_secret_configured: true, manual_operations_mailbox_ready: true
        }, warnings: [raw]
    });
    f.operation.mockResolvedValue({ allowed: true, reason_code: 'synthetic_allowed', company_status: 'active', capability_status: 'enabled', production_status: 'active', state_version: 1 });
    f.offer.mockResolvedValue({ offer_reference: commercial.offer_reference, company_id: companyId, customer_type: 'private' });
    for (const loader of [f.quote, f.validate, f.process])
        loader.mockRejectedValue({ code: '23505', message: raw, details: raw, hint: raw, response: { authorization: raw } });
    f.usage.mockResolvedValue(undefined);
    errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    warnLog = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    infoLog = vi.spyOn(console, 'info').mockImplementation(() => undefined);
});
afterEach(() => { errorLog.mockRestore(); warnLog.mockRestore(); infoLog.mockRestore(); });
describe.each(routes)('actual authenticated checkout $name error boundary', ({ path, post, body, loader, scope, code }) => {
    it('parses valid contract input, uses current real authority and logs only technical failure while retaining response trace', async () => {
        const foreign = structuredClone(f.tables.integration_api_write_idempotency[0]), response = await post(request(path, body));
        expect(loader).toHaveBeenCalledOnce();
        expect(f.rpc).toHaveBeenCalledOnce();
        expect(f.rpc.mock.calls[0][1]).toMatchObject({ p_required_all: [scope] });
        expect(loader.mock.calls[0][0].client.company_id).toBe(companyId);
        if (path.includes('customer-applications')) {
            expect(f.automation).toHaveBeenCalledWith(companyId);
            expect(f.operation).toHaveBeenCalled();
            const submitted = loader.mock.calls[0][0].rawBody;
            expect(ApplicationSchema.safeParse(submitted).success).toBe(true);
            expect(validateNestedPayloadFields(submitted)).toBeNull();
        }
        expect(response.status).toBe(500);
        const result = await response.json();
        expect(result.error.code).toBe(code);
        expect(result.request_id).toMatch(/^[a-f0-9-]{36}$/);
        expect(response.headers.get('X-Request-ID')).toBe(result.request_id);
        expect(result.correlation_id).toBe(result.request_id);
        expect(errorLog).toHaveBeenCalledOnce();
        absent(result);
        absent(errorLog.mock.calls);
        absent(f.telemetry);
        expect(inspect(errorLog.mock.calls, { depth: 14 })).toContain('23505');
        expect(inspect(errorLog.mock.calls)).toContain(result.request_id);
        expect(f.telemetry[0].metadata).toMatchObject({ request_id: result.request_id });
        expect(f.tables.integration_api_write_idempotency[0]).toEqual(foreign);
        if (path === '/api/v1/website/quote')
            expect(f.tables.integration_api_write_idempotency[1]).toMatchObject({ company_id: companyId, api_client_id: clientId, status: 'failed', error_code: 'website_quote_failed' });
    });
    it('denies the current scope before readiness, quote/idempotency/application business effects', async () => {
        f.allowed = false;
        const response = await post(request(path, body));
        expect(response.status).toBe(403);
        expect((await response.json()).error.code).toBe('api_scope_missing');
        noBusiness();
        expect(errorLog).not.toHaveBeenCalled();
        expect(warnLog).not.toHaveBeenCalled();
    });
    it('retains current paused-company denial before any business effects', async () => {
        f.allowed = false;
        f.authCode = 'tenant_paused';
        f.authStatus = 'paused';
        const response = await post(request(path, body));
        expect(response.status).toBe(423);
        expect((await response.json()).error.code).toBe('organization_paused');
        noBusiness();
        expect(errorLog).not.toHaveBeenCalled();
    });
    it('rejects absent credentials before Auth RPC and tenant telemetry', async () => {
        f.hasToken = false;
        const response = await post(request(path, body));
        expect(response.status).toBe(401);
        expect((await response.json()).error.code).toBe('missing_api_token');
        expect(f.rpc).not.toHaveBeenCalled();
        expect(f.telemetry).toEqual([]);
        noBusiness();
        expect(errorLog).not.toHaveBeenCalled();
    });
    it('retains current revoked-token denial before business effects', async () => {
        f.allowed = false;
        f.authCode = 'invalid_api_token';
        const response = await post(request(path, body));
        expect(response.status).toBe(401);
        expect((await response.json()).error.code).toBe('invalid_api_token');
        expect(f.rpc).toHaveBeenCalledOnce();
        noBusiness();
        expect(errorLog).not.toHaveBeenCalled();
    });
});
it('actual customer-application tenant binder denies a foreign tenant claim before the intake loader', async () => {
    const response = await application(request('/api/v1/website/customer-applications', { ...appBody, company_id: '00000000-0000-4000-8000-000000000099' }));
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe('organization_context_mismatch');
    expect(f.process).not.toHaveBeenCalled();
    expect(errorLog).not.toHaveBeenCalled();
});
it.each(routes.slice(0, 2))('actual $name rejects caller tenant fields before quote/idempotency loaders', async ({ path, post, body, loader }) => {
    const response = await post(request(path, { ...body, company_id: '00000000-0000-4000-8000-000000000099' }));
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('unknown_field');
    expect(loader).not.toHaveBeenCalled();
    expect(f.tables.integration_api_write_idempotency).toHaveLength(1);
    expect(errorLog).not.toHaveBeenCalled();
});
it('actual readiness derives fixed blocked checks/codes; existing warning excludes free company/automation diagnostics', async () => {
    f.tables.tenant_website_readiness_v[0].has_public_contracts = false;
    const response = await application(request('/api/v1/website/customer-applications', appBody)), body = await response.json();
    expect(response.status).toBe(409);
    expect(body.error.code).toBe('integration_not_ready');
    expect(f.process).not.toHaveBeenCalled();
    expect(warnLog).toHaveBeenCalledOnce();
    const logged = warnLog.mock.calls[0][1] as Row;
    expect(logged).toMatchObject({
        requestId: body.request_id, website_checkout_ready: false, portal_identity_submission_mode: 'post_auth_allowed',
        blocker_codes: ['public_contracts_missing'], checkout_blocker_codes: ['public_contracts_missing'], failed_checks: ['public_contracts_present', 'webhook_subscription_present']
    });
    absent(warnLog.mock.calls);
    absent(body);
    absent(f.telemetry);
    expect(errorLog).not.toHaveBeenCalled();
});
it('actual real intake validation code is retained in new diagnostic sinks without its caller-derived free message', async () => {
    f.useActualProcess = true;
    const response = await application(request('/api/v1/website/customer-applications', { ...appBody, customer: { ...appBody.customer, customer_type: raw } }));
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.error.code).toBe('customer_type_invalid');
    absent(body);
    expect(f.telemetry).toHaveLength(1);
    expect(f.telemetry[0].error_code).toBe('customer_type_invalid');
    absent(f.telemetry);
    absent(f.usage.mock.calls);
    expect(f.quote).not.toHaveBeenCalled();
    expect(f.validate).not.toHaveBeenCalled();
    expect(errorLog).not.toHaveBeenCalled();
});
it('retains an existing classified quote rejection and its completed idempotency receipt', async () => {
    f.quote.mockRejectedValue(new OfferQuoteError('The current price option is unavailable.', 'price_option_not_available', 422, 'price_option_reference'));
    const response = await quote(request('/api/v1/website/quote', commercial)), body = await response.json();
    expect(response.status).toBe(422);
    expect(body.error).toMatchObject({ code: 'price_option_not_available', field: 'price_option_reference' });
    expect(body.error.message).toBe('The current price option is unavailable.');
    expect(f.telemetry[0].error_code).toBe('price_option_not_available');
    expect(errorLog).not.toHaveBeenCalled();
    expect(f.tables.integration_api_write_idempotency[1]).toMatchObject({ company_id: companyId, status: 'completed', response_status: 422, response_body: body });
});
it('retains an existing classified quote-validation rejection without unknown-error logging', async () => {
    f.validate.mockRejectedValue(new WebsiteQuoteValidationError({ message: 'The quote has expired.', code: 'quote_expired', status: 422, field: 'quote_reference' }));
    const response = await validate(request('/api/v1/website/quote/validate', { ...commercial, quote_reference: 'SYNTHETIC-QUOTE' })), body = await response.json();
    expect(response.status).toBe(422);
    expect(body.error).toMatchObject({ code: 'quote_expired', field: 'quote_reference', message: 'The quote has expired.' });
    expect(f.telemetry[0].error_code).toBe('quote_expired');
    expect(errorLog).not.toHaveBeenCalled();
    expect(f.tables.integration_api_write_idempotency).toHaveLength(1);
});
it.each(routes)('retains installed Next control flow from actual $name authorization before diagnostics', async ({ path, post, body }) => {
    let signal: unknown;
    try {
        redirect('/synthetic-checkout-control-flow');
    }
    catch (error) {
        signal = error;
    }
    expect(signal).toBeTruthy();
    f.rpc.mockRejectedValue(signal);
    await expect(post(request(path, body))).rejects.toBe(signal);
    noBusiness();
    expect(f.telemetry).toEqual([]);
    expect(errorLog).not.toHaveBeenCalled();
    expect(warnLog).not.toHaveBeenCalled();
});
