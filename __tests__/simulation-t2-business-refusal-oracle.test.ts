// Component controls: execute the real registered scenario callbacks with controlled ports.
// No database, network, fixture creation or scenario PASS is produced by these tests.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import * as crypto from 'node:crypto'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import * as oracle from '../scripts/simulation/track2/lib/term-oracle'
import * as data from '../scripts/simulation/track2/lib/term02-data'

const root = fileURLToPath(new URL('../scripts/simulation/track2/', import.meta.url))
const terms = { markupOrePerKwh: '4', monthlyFeeSek: '49', invoiceFeeSek: '19', vatPercent: 25 }
const refuseIO = () => { throw new Error('Uncontrolled service or filesystem access refused') }

function evaluate(filename: string, imports: Record<string, unknown>, globals: Record<string, unknown> = {}) {
  const output = { exports: {} as Record<string, unknown> }
  const source = readFileSync(filename, 'utf8')
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  runInNewContext(code, {
    exports: output.exports,
    require: (name: string) => {
      if (!Object.hasOwn(imports, name)) throw new Error('Uncontrolled import refused: ' + name)
      return imports[name]
    },
    ...globals,
  }, { filename, timeout: 5000 })
  return output.exports
}

// Use the real comparison/arithmetic functions; only their service ports are replaced.
const billing = evaluate(path.join(root, 'lib/term-billing.ts'), {
  'node:crypto': crypto,
  './db': { psql: refuseIO, psqlRows: refuseIO, serviceClient: refuseIO },
  './term-oracle': oracle,
})

type Options = {
  group?: 'monthly' | 'overlap'
  status?: number
  invalidData?: unknown
  setupError?: Error
  setupStage?: 'contract' | 'supply'
  wrong?: 'source-count' | 'missing' | 'quantity' | 'coverage' | 'base' | 'fee' | 'vat' | 'total'
  overlap?: 'none' | 'wrong-status' | 'double-billed' | 'no-underlays'
  generateStatus?: number
}

function registeredCallback(options: Options = {}) {
  const monthly = options.group !== 'overlap'
  const tests: Array<{ name: string; run: () => Promise<void> }> = []
  const calls = { contract: 0, supply: 0, generate: 0, preview: 0, observations: [] as string[] }
  const contract = { companyId: 'component-company', customerId: 'component-customer', siteId: 'component-site', meteringPointId: 'component-point', gsrn: 'component-gsrn' }
  const tenant = { companyId: contract.companyId, admin: { email: 'component@example.invalid', password: 'synthetic-component', userId: 'component-user' } }
  const points = monthly
    ? data.quartersOnHourlyPrices(data.term0204QuarterWh, data.term0204HourlyPrices('2026-08'), '2026-08')
    : data.term0203Hourly('2026-09').map(p => ({ ...p, wh: data.hourlyShapeWh(p.slot.startMs) }))
  const intervals = data.toOracle(points)
  const expected = oracle.oracleInvoice({ intervals, terms }, 'half_away')
  const quantity = oracle.decToString(oracle.sumKwh(intervals))
  const preview = {
    status: 'success', errors: [], warnings: [],
    totalExVat: Number(expected.totalExVatOre) / 100,
    vatAmount: Number(expected.totalVatOre) / 100,
    totalIncVat: Number(expected.totalIncVatOre) / 100,
    lines: expected.lines.map(line => ({
      lineType: line.code === 'spot' ? 'base_price' : 'component', description: line.code,
      amountExVat: Number(line.exVatOre) / 100, vatAmount: Number(line.vatOre) / 100,
      amountIncVat: Number(line.incVatOre) / 100,
      metadata: line.code === 'spot'
        ? { source_type: 'spot', source_price_sek_per_kwh: oracle.weightedPrice(intervals).weightedAsNumber }
        : { component_code: line.code === 'markup' ? 'spot_markup' : line.code },
    })),
  }
  if (options.wrong === 'base') preview.lines[0].amountExVat += 1
  if (options.wrong === 'fee') preview.lines.find(line => line.description === 'monthly_fee')!.amountExVat += 1
  if (options.wrong === 'vat') preview.lines[0].vatAmount += 1
  if (options.wrong === 'total') preview.totalIncVat += 1
  const row = {
    ...contract, id: 'component-underlay', metering_point_id: contract.meteringPointId,
    status: 'validated', readiness_status: 'ready', total_kwh: options.wrong === 'quantity' ? '1' : quantity,
    source_meter_value_count: points.length - (options.wrong === 'source-count' ? 1 : 0),
    missing_values_count: options.wrong === 'missing' ? 1 : 0,
  }
  const result = {
    underlayId: row.id, status: options.overlap === 'wrong-status' || monthly ? 'ready_for_pricing' : 'needs_review',
    sourceRows: points.length,
    warnings: monthly ? (options.wrong === 'coverage' ? ['Lucka i mätvärden'] : [])
      : (options.overlap === 'none' ? [] : ['Överlappande leveransperioder']),
  }
  const fakeBilling = {
    ...billing,
    disableConsumptionEstimates: () => {},
    spotImportFootprint: () => ({ runs: 0, jobs: 0 }),
    insertSpotIntervals: () => {}, prepareAndLockSpotMonth: async () => ({}), insertMeteringValues: () => ({}),
    readContractTerms: () => terms,
    createSupplyPeriod: () => {
      calls.supply++
      if (options.setupError && options.setupStage === 'supply' && calls.supply === (monthly ? 1 : 2)) throw options.setupError
      return 'component-supply-' + calls.supply
    },
    generateUnderlay: async () => { calls.generate++; return { status: options.generateStatus ?? 200, data: { results: [result] } } },
    readUnderlaysForMonth: () => options.overlap === 'no-underlays' ? [] : [{ ...row,
      total_kwh: options.overlap === 'double-billed' ? oracle.decToString(oracle.decMul(oracle.dec(quantity), oracle.dec(2))) : row.total_kwh,
    }],
    pricePreview: async () => {
      calls.preview++
      return { status: options.status ?? 200, data: Object.hasOwn(options, 'invalidData') ? options.invalidData : preview, text: 'controlled response' }
    },
  }
  evaluate(path.join(root, 'scenarios', monthly ? 'term02.test.ts' : 'term03.test.ts'), {
    'node:fs': { mkdirSync: refuseIO, writeFileSync: refuseIO }, 'node:path': path,
    vitest: { describe: (_name: string, callback: () => void) => callback(),
      it: (name: string, run: () => Promise<void>) => tests.push({ name, run }), beforeAll: () => {}, afterAll: () => {}, expect },
    '../lib': { loginSession: async () => ({}), removeAdminFixtureUser: refuseIO, SIM_HOME: 'component-private-home',
      psqlRows: () => [{ n: 1 }], psql: refuseIO },
    '../lib/term-fixture': {
      createTermTenant: async () => tenant,
      createSignedContract: async () => {
        calls.contract++
        if (options.setupError && options.setupStage === 'contract' && calls.contract === (monthly ? 1 : 2)) throw options.setupError
        return { ...contract, contractId: 'component-contract-' + calls.contract }
      },
    },
    '../lib/term-billing': fakeBilling, '../lib/term-oracle': oracle, '../lib/term02-data': data,
    '../lib/server-action': { callServerAction: refuseIO }, '../lib/term-page': { readContractPage: refuseIO },
  }, { process: { env: {} }, console: { info: (...args: unknown[]) => calls.observations.push(args.join(' ')) } })
  const prefix = monthly ? 'TERM02.04 f) månadsavtal + kvartsmätning:' : 'TERM03.05b appen flaggar överlapp'
  const registered = tests.filter(test => test.name.startsWith(prefix))
  expect(registered).toHaveLength(1)
  return { run: registered[0].run, calls }
}

describe('TERM02 monthly-quarterly actual callback requires a successful pricing decision', () => {
  it.each([400, 401, 403, 404, 409, 500, 503])('rejects HTTP %i, never calls it a business refusal', async status => {
    const test = registeredCallback({ status, invalidData: null })
    await expect(test.run()).rejects.toThrow()
  })
  it.each([null, {}, { status: 'failed', errors: ['generic failure'] }, { status: 'needs_review', errors: ['no decision'] }])('rejects empty, malformed or unsuccessful data: %j', async invalidData => {
    await expect(registeredCallback({ invalidData }).run()).rejects.toThrow()
  })
  it.each(['source-count', 'missing', 'quantity', 'coverage', 'base', 'fee', 'vat', 'total'] as const)('checks actual coverage and money after successful pricing: %s', async wrong => {
    await expect(registeredCallback({ wrong }).run()).rejects.toThrow()
  })
  it('accepts supported pricing only after real coverage and arithmetic assertions', async () => {
    const test = registeredCallback()
    await expect(test.run()).resolves.toBeUndefined()
    expect(test.calls).toMatchObject({ contract: 1, supply: 1, generate: 1, preview: 2 })
    expect(test.calls.observations.some(line => line.includes('ÖPPEN ORAKELFRÅGA'))).toBe(true)
  })
  it.each(['contract', 'supply'] as const)('propagates setup failure from %s unchanged', async setupStage => {
    const error = new Error('component setup failed; no business decision')
    const test = registeredCallback({ setupStage, setupError: error })
    await expect(test.run()).rejects.toBe(error)
    expect(test.calls.preview).toBe(0)
  })
  it('rejects failed generate-underlay setup', async () => {
    await expect(registeredCallback({ generateStatus: 500 }).run()).rejects.toThrow()
  })
})

describe('TERM03 overlap actual callback must reach real overlap and no-double-billing checks', () => {
  it.each([
    ['contract', 'createContractFromOfferAction: server action misslyckades (HTTP 500, kastade=true, redirect=-)'],
    ['contract', 'createContractFromOfferAction: server action misslyckades (HTTP 401, kastade=true, redirect=-)'],
    ['contract', 'createContractFromOfferAction: skapade 0 nya avtal'],
    ['contract', 'unrelated fixture infrastructure error'],
    ['supply', 'SQL timeout; no database response; outcome unknown'],
    ['supply', 'connection lost; outcome unknown'],
    ['supply', 'arbitrary constraint error without qualified domain evidence'],
  ] as const)('propagates %s failure without inventing business refusal: %s', async (setupStage, message) => {
    const error = Object.assign(new Error(message), { stderr: message })
    const test = registeredCallback({ group: 'overlap', setupStage, setupError: error })
    await expect(test.run()).rejects.toBe(error)
    expect(test.calls.generate).toBe(0)
  })
  it.each(['none', 'wrong-status', 'double-billed', 'no-underlays'] as const)('rejects incomplete or wrong overlap behavior: %s', async overlap => {
    await expect(registeredCallback({ group: 'overlap', overlap }).run()).rejects.toThrow()
  })
  it('accepts actual overlap warnings and one physical measured total after both setups succeed', async () => {
    const test = registeredCallback({ group: 'overlap' })
    await expect(test.run()).resolves.toBeUndefined()
    expect(test.calls).toMatchObject({ contract: 2, supply: 2, generate: 1, preview: 0 })
  })
})

// Actual TEN privacy callback and installed Next inline encoder; no services or untrusted script execution.
import { createRequire } from 'node:module';
const tenantSourceRoot = path.resolve(root, '../../..');
const tenantRequire = createRequire(new URL('../package.json', import.meta.url));
const { createInlinedDataReadableStream } = tenantRequire('next/dist/server/app-render/use-flight-response.js');
function tenantControl(mode: string) {
    const fixture = { companyId: '00000000-0000-4000-8000-000000000001', customerId: '00000000-0000-4000-8000-000000000002', contractId: '00000000-0000-4000-8000-000000000003', siteId: '00000000-0000-4000-8000-000000000004', meteringPointId: '00000000-0000-4000-8000-000000000005', gsrn: '735999100000000001' };
    const customer = { name: mode === 'escaped-leak' ? 'Syntetisk <Hemlig> & Kund' : 'Syntetisk Hemlig Kund', personal_number: '199001019999', email: 't2-own-private@example.invalid' };
    const observed: Array<{
        html: string;
    }> = [];
    const tests = new Map<string, () => Promise<void>>();
    const scriptGlobal: {
        __tenantOracleExecuted?: boolean;
    } = {};
    const inline = async (value: string, formState: unknown = null) => new Response(createInlinedDataReadableStream(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(value)); controller.close(); } }), null, formState)).text();
    const own = { fetch: async () => new Response(mode === 'own-flight' ? await inline('1:' + JSON.stringify({ email: customer.email, gsrn: fixture.gsrn }) + '\n') : `<main>${customer.email} ${fixture.gsrn}</main>`, { status: 200 }) };
    const foreign = { fetch: async () => {
            const scriptMode = ['script-leak', 'split-leak', 'escaped-leak', 'binary-leak', 'binary-text-split', 'inner-escaped', 'formstate-leak', 'benign-flight', 'benign-formstate', 'benign-binary', 'benign-binary-text-split'].includes(mode);
            let leak = JSON.stringify(mode === 'escaped-leak' ? { name: customer.name } : ['split-leak', 'binary-leak', 'binary-text-split', 'inner-escaped'].includes(mode) ? { email: customer.email } : ['benign-flight', 'benign-formstate', 'formstate-leak', 'benign-binary', 'benign-binary-text-split'].includes(mode) ? { notice: 'not-found' } : { ...customer, gsrn: fixture.gsrn, siteId: fixture.siteId, contractId: fixture.contractId });
            if (mode === 'inner-escaped')
                leak = leak.replace('@', '\\u0040');
            const bytes = new TextEncoder().encode('1:' + leak + '\n');
            let chunks = [bytes];
            if (mode === 'split-leak') {
                const cut = Buffer.from(bytes).indexOf(customer.email) + Math.floor(customer.email.length / 2);
                chunks = [bytes.slice(0, cut), bytes.slice(cut)];
            }
            if (mode === 'binary-leak' || mode === 'benign-binary')
                chunks = [Buffer.concat([Buffer.from([255]), bytes])];
            if (mode === 'binary-text-split') {
                const cut = Buffer.from(bytes).indexOf(customer.email) + Math.floor(customer.email.length / 2);
                chunks = [Buffer.concat([Buffer.from([255]), bytes.slice(0, cut)]), bytes.slice(cut)];
            }
            if (mode === 'benign-binary-text-split') {
                const cut = Math.floor(bytes.length / 2);
                chunks = [Buffer.concat([Buffer.from([255]), bytes.slice(0, cut)]), bytes.slice(cut)];
            }
            const flight = new ReadableStream({ start(controller) { for (const chunk of chunks)
                    controller.enqueue(chunk); controller.close(); } });
            let actualNextScript = scriptMode ? await new Response(createInlinedDataReadableStream(flight, null, mode === 'formstate-leak' ? { email: customer.email } : mode === 'benign-formstate' ? { notice: 'not-found' } : null)).text() : '';
            const bootstrap = '<script>(self.__next_f=self.__next_f||[]).push([0])</script>';
            const malformed: Record<string, string> = {
                'bad-base64': bootstrap + '<script>self.__next_f.push([3,"!invalid"])</script>',
                'noncanonical-base64': bootstrap + '<script>self.__next_f.push([3,"QR=="])</script>',
                'bad-json': bootstrap + '<script>self.__next_f.push([1,"unterminated])</script>',
                'nonliteral': bootstrap + '<script>self.__next_f.push((()=>{globalThis.__tenantOracleExecuted=true;return [1,"ignored"]})())</script>',
                'unknown-tag': bootstrap + '<script>self.__next_f.push([9,"ignored"])</script>',
                'missing-bootstrap': '<script>self.__next_f.push([1,"ignored"])</script>',
                'duplicate-bootstrap': bootstrap + bootstrap,
                'bad-bootstrap': '<script>(self.__next_f=self.__next_f||[]).push([0,"ignored"])</script>',
                'nonstring-text': bootstrap + '<script>self.__next_f.push([1,{}])</script>',
                'extra-field': bootstrap + '<script>self.__next_f.push([1,"ignored",1])</script>',
                'unknown-inline': '<script>globalThis.__tenantOracleExecuted=true</script>',
                'unclosed-script': '<script>self.__next_f.push([0])',
                'late-formstate': bootstrap + '<script>self.__next_f.push([1,"ignored"]);self.__next_f.push([2,{}])</script>',
                'trailing-code': bootstrap + '<script>self.__next_f.push([1,"ignored"]);globalThis.__tenantOracleExecuted=true</script>',
            };
            if (malformed[mode])
                actualNextScript = malformed[mode];
            const html = mode === 'attribute-leak' ? `<main data-email="${customer.email.replace('@', '&#64;')}">Kunden finns inte</main>` : (scriptMode || actualNextScript) ? `<main>Kunden finns inte. Referens: ${fixture.customerId}</main>${actualNextScript}` : mode === 'visible-leak' ? `<main>${leak}</main>` : mode === 'benign-external' ? '<script src="/_next/static/chunks/app.js" async></script><main>Kunden finns inte</main>' : `<main>Kunden finns inte. Referens: ${fixture.customerId}</main>`;
            observed.push({ html });
            return new Response(html, { status: 200 });
        } };
    const tenant = { companyId: fixture.companyId, admin: { email: 'tenant-A@example.invalid', password: 'synthetic' } };
    const forbidden = () => { throw new Error('undeclared service operation'); };
    const register = Object.assign((title: string, callback: () => Promise<void>) => tests.set(title, callback), { each: () => () => { }, skip: () => { } });
    const ports: Record<string, unknown> = {
        'node:buffer': tenantRequire('node:buffer'),
        vitest: { describe: (_title: string, callback: () => void) => callback(), it: register, beforeAll: () => { }, afterAll: () => { }, expect },
        '../lib': { loginSession: async () => foreign, removeAdminFixtureUser: async () => { }, psql: forbidden, psqlRows: (sql: string) => {
                if (sql.includes('coalesce(nullif(trim(concat_ws'))
                    return [customer];
                if (sql.includes('select org_number'))
                    return [{ org_number: '5599999999' }];
                throw new Error('undeclared SQL read');
            } },
        '../lib/server-action': { assertContractEditFeedback: forbidden, callServerAction: forbidden },
        '../lib/term-fixture': { createSignedContract: forbidden, createTermTenant: async () => ({ companyId: '00000000-0000-4000-8000-000000000099', admin: { email: 'tenant-B@example.invalid', password: 'synthetic' } }), probeCreateCustomerAction: forbidden, probeCreateContractTsPath: forbidden, psqlExpectError: forbidden, rowHash: forbidden, stockholmToday: forbidden },
    };
    const filename = path.join(tenantSourceRoot, 'scripts/simulation/track2/scenarios/term01.test.ts');
    const source = readFileSync(filename, 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
    const exports: {
        controlledPrime?: (...args: unknown[]) => void;
    } = {};
    // The already-qualified own fixture is a declared port. Actual TEN callback,
    // response decoder, marker selection, status and leak assertions execute.
    runInNewContext(code + '\nexports.controlledPrime=(a,b,c)=>{tenant=a;session=b;signed=async()=>c};', {
        exports, require: (name: string) => { if (!(name in ports))
            throw new Error('undeclared import'); return ports[name]; }, console: { info() { } }, Intl, globalThis: scriptGlobal,
    }, { filename });
    if (!exports.controlledPrime)
        throw new Error('missing controlled fixture port');
    exports.controlledPrime(tenant, own, fixture);
    const callback = [...tests].find(([title]) => title.startsWith('TERM01.TEN '))?.[1];
    expect(callback).toBeTypeOf('function');
    if (!callback)
        throw new Error('missing actual TEN callback');
    return { callback, observed, customer, fixture, scriptGlobal };
}
describe('T6 actual tenant guard response oracle', () => {
    it('accepts genuine soft200 denial with harmless requested customer ID echo', async () => {
        const c = tenantControl('denied');
        await c.callback();
        expect(c.observed).toHaveLength(8);
    });
    it('rejects visible foreign tenant markers as a real negative control', async () => {
        const c = tenantControl('visible-leak');
        await expect(c.callback()).rejects.toThrow('tenant 1-data');
    });
    it('rejects foreign tenant data leaked only in the actual HTML RSC script response', async () => {
        const c = tenantControl('script-leak');
        await expect(c.callback()).rejects.toThrow('tenant 1-data');
        expect(c.observed[0].html).toContain(c.customer.email);
    });
});
describe('T6 actual Next Flight encoding and chunk boundaries', () => {
    it.each(['split-leak', 'escaped-leak', 'binary-leak', 'binary-text-split'])('rejects %s even when no complete foreign marker appears in raw HTML plaintext', async (mode) => {
        const c = tenantControl(mode);
        let error;
        try {
            await c.callback();
        }
        catch (caught) {
            error = caught;
        }
        expect(c.observed.length).toBeGreaterThan(0);
        const marker = mode === 'escaped-leak' ? c.customer.name : c.customer.email;
        expect(c.observed[0].html).not.toContain(marker);
        expect(error, 'actual TEN callback must refuse foreign Flight data rather than strip its representation').toBeDefined();
        expect((error as Error).message).toContain('tenant 1-data');
    });
});
describe('TEN privacy qualified representations and malformed boundaries', () => {
    it.each(['benign-flight', 'benign-formstate', 'own-flight', 'benign-external', 'benign-binary', 'benign-binary-text-split'])('accepts genuine %s without foreign data', async (mode) => {
        const c = tenantControl(mode);
        await c.callback();
        if (mode.startsWith('benign-binary')) expect(c.observed[0].html).toContain('.push([3,');
        if (mode === 'benign-binary-text-split') expect(c.observed[0].html).toContain('.push([1,');
    });
    it.each(['inner-escaped', 'formstate-leak', 'attribute-leak'])('refuses private marker in %s', async (mode) => {
        await expect(tenantControl(mode).callback()).rejects.toThrow('tenant 1-data');
    });
    it.each(['bad-base64', 'noncanonical-base64', 'bad-json', 'nonliteral', 'unknown-tag', 'missing-bootstrap', 'duplicate-bootstrap', 'bad-bootstrap', 'nonstring-text', 'extra-field', 'unknown-inline', 'unclosed-script', 'late-formstate', 'trailing-code'])('fails qualification for %s without evaluating scripts', async (mode) => {
        const c = tenantControl(mode);
        await expect(c.callback()).rejects.toThrow();
        expect(c.scriptGlobal.__tenantOracleExecuted).toBeUndefined();
    });
});
