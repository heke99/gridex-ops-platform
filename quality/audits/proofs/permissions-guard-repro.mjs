// Read-only synthetic reproduction: Node >=24, no packages, DB or network.
// Execute from repository root. This asserts the observed vulnerable behavior,
// so it is evidence, not a regression test that should remain green after a fix.
import { stripTypeScriptTypes } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

function actualModule(path, exports, dependencies = {}) {
  const source = stripTypeScriptTypes(readFileSync(path, 'utf8'))
    .replace(/^import[\s\S]*?from ['"][^'"]+['"]\s*;?\n/gm, '')
    .replace(/^export /gm, '');
  const context = vm.createContext({ console, ...dependencies });
  vm.runInContext(`${source}\nglobalThis.result = {${exports.join(',')}};`, context, { filename: path });
  return context.result;
}

const access = actualModule('lib/admin/accessModel.ts', ['hasPermissionRequirement']);
const roles = actualModule('lib/rbac/roleKeys.ts', ['normalizeRoleKey', 'resolveRoleKey', 'isPlatformAdminRole']);
const lifecycle = actualModule('lib/tenant/lifecycle.ts', ['isCompanyWritableInTenantWorkspace']);
const calls = [];
const mutations = [];
const state = { selected: 'A' };
const redirect = path => { throw new Error(`redirect:${path}`); };
const guard = actualModule('lib/admin/guards.ts', ['requireCompanyScopedActionAccess'], {
  ...access, ...roles, ...lifecycle,
  cache: fn => fn,
  cookies: async () => ({ get: () => ({ value: state.selected }) }),
  redirect,
  ADMIN_SELECTED_COMPANY_COOKIE: 'company',
  listOperationalCompaniesForUser: async () => [
    { companyId: 'A', membershipRole: 'admin', companyStatus: 'active' },
    { companyId: 'B', membershipRole: 'admin', companyStatus: 'active' },
  ],
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'actor' } } }) },
    rpc: async (name, args) => {
      calls.push({ name, args });
      return { data: {
        authorized: true, user_id: 'actor', is_platform_admin: false,
        selected_company_id: state.selected, roles: ['custom_role'],
        permissions: state.selected === 'A' ? ['integrations.write'] : ['customers.read'],
      } };
    },
  }),
});

const accepted = await guard.requireCompanyScopedActionAccess('B', { anyOf: ['integrations.write'] });
assert.equal(accepted.companyId, 'A');
assert.equal(calls[0].args.p_selected_company_id, 'A');
state.selected = 'B';
await assert.rejects(guard.requireCompanyScopedActionAccess('B', { anyOf: ['integrations.write'] }), /Forbidden/);

const fakeDb = { from: table => ({
  update: values => {
    const mutation = { table, values, filters: {} };
    const chain = {
      eq: (key, value) => { mutation.filters[key] = value; return chain; },
      then: (resolve, reject) => {
        mutations.push(mutation);
        return Promise.resolve({ error: null }).then(resolve, reject);
      },
    };
    return chain;
  },
  insert: async () => ({ error: null }),
}) };
const action = actualModule('app/admin/webhooks/actions.ts', ['markWebhookDeliveryIgnoredAction'], {
  ...guard, supabaseService: fakeDb, redirect, revalidatePath: () => {},
});
const form = new FormData();
form.set('company_id', 'B');
form.set('delivery_id', 'delivery-B');
state.selected = 'A';
await assert.rejects(action.markWebhookDeliveryIgnoredAction(form), /redirect:.*success=/);
assert.equal(mutations.length, 1);
assert.equal(mutations[0].table, 'webhook_deliveries');
assert.equal(mutations[0].filters.company_id, 'B');
assert.equal(mutations[0].filters.id, 'delivery-B');
assert.equal(mutations[0].values.status, 'skipped');
state.selected = 'B';
await assert.rejects(action.markWebhookDeliveryIgnoredAction(form), /Forbidden/);
assert.equal(mutations.length, 1, 'Denied request must not create another fake mutation');
console.log('CONFIRMED PERM-01: actual guard and actual webhook action write B using A permissions; B-selected negative rejects before fake DB.');

const wrappedCalls = [];
const wrapper = actualModule('lib/supabase/tenantDb.ts', ['tenantDb'], {
  supabaseService: { from: table => ({ update: values => ({
    eq: (key, value) => { wrappedCalls.push({ table, values, key, value }); },
  }) }) },
});
wrapper.tenantDb('A').from('example').update({ company_id: 'B' });
assert.equal(wrappedCalls[0].values.company_id, 'B');
assert.equal(wrappedCalls[0].value, 'A');
console.log('CONFIRMED wrapper limit: UPDATE filters old owner A and forwards new owner B. No real query executed.');
