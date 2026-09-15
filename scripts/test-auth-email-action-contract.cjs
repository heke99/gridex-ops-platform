const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { stripTypeScriptTypes } = require('node:module')
const vm = require('node:vm')
const { test } = require('node:test')

const root = path.resolve(__dirname, '..')
const eventTypes = [
  'invite_sent', 'password_reset_sent', 'confirmation_sent', 'email_action_verified',
  'password_updated', 'company_invitation_accepted', 'direct_user_created',
]
// Retained source contract; this is a mock boundary, not PostgreSQL execution.
const source = fs.readFileSync(path.join(root, 'supabase/migrations/20260520_direct_temporary_password_auth_sync_fix.sql'), 'utf8')
const actionCheck = source.match(/add constraint auth_email_events_action_check\s+check \(action in \(([\s\S]*?)\)\)/i)
assert.ok(actionCheck, 'Retained action CHECK must be located')
const allowedActions = new Set([...actionCheck[1].matchAll(/'([^']+)'/g)].map(match => match[1]))

async function load(relative, mocks) {
  const context = vm.createContext({ URL, Date, console })
  const module = new vm.SourceTextModule(stripTypeScriptTypes(fs.readFileSync(path.join(root, relative), 'utf8')), { context })
  await module.link(name => {
    assert.ok(Object.hasOwn(mocks, name), `Unmocked import: ${name}`)
    const exports = mocks[name]
    return new vm.SyntheticModule(Object.keys(exports), function () {
      for (const [key, value] of Object.entries(exports)) this.setExport(key, value)
    }, { context })
  })
  await module.evaluate()
  return module.namespace
}

async function fixture({ company = true, smtpReady = true, eventError = null } = {}) {
  const events = [], sent = [], reset = [], updates = []
  const supabaseService = {
    auth: {
      admin: {
        listUsers: async () => ({ data: { users: [{ id: 'user-1', email: 'user@example.test' }] }, error: null }),
        generateLink: async () => ({ data: { properties: { action_link: 'https://example.test/recovery' } }, error: null }),
      },
      resetPasswordForEmail: async (...args) => { reset.push(args); return { error: null } },
    },
    from(table) {
      if (table === 'auth_email_events') return {
        insert: async payload => {
          events.push(JSON.parse(JSON.stringify(payload)))
          // Faithful to the source NOT NULL/CHECK; reject the old omitted action.
          if (payload.action == null) return { error: { code: '23502', message: 'required action' } }
          if (!allowedActions.has(payload.action)) return { error: { code: '23514', message: 'invalid action' } }
          return { error: eventError }
        },
      }
      assert.ok(['user_profiles', 'company_memberships'].includes(table), `Unexpected table ${table}`)
      const chain = {
        select() { return chain }, eq() { return chain }, neq() { return chain },
        order() { return chain }, limit() { return chain },
        update(payload) { updates.push(payload); return chain },
        async maybeSingle() { return { data: company ? (table === 'user_profiles' ? { active_company_id: 'company-1' } : { company_id: 'company-1' }) : null, error: null } },
      }
      return chain
    },
  }
  const common = {
    '@/lib/auth/urls': { getBaseAppUrl: () => 'https://example.test', getSafeNextPath: value => value },
    '@/lib/supabase/service': { supabaseService },
  }
  const resetModule = await load('lib/tenant/passwordResetEmail.ts', {
    ...common,
    '@/lib/tenant/emailBranding': { getTenantEmailBranding: async () => ({ displayName: 'Tenant', supportEmail: 'support@example.test' }), renderTenantEmailLayout: () => '<p>Reset</p>' },
    '@/lib/auth/smtpTransactionalEmail': { getAuthSmtpReadiness: () => ({ ready: smtpReady, missing: smtpReady ? [] : ['SMTP_HOST'], message: 'SMTP unavailable' }), sendTransactionalEmail: async payload => { sent.push(payload) } },
  })
  const authModule = await load('lib/auth/authEmailFlow.ts', {
    ...common,
    '@/lib/tenant/passwordResetEmail': { sendTenantBrandedPasswordResetEmail: resetModule.sendTenantBrandedPasswordResetEmail },
  })
  return { authModule, resetModule, events, sent, reset, updates }
}

for (const eventType of eventTypes) test(`auth writer preserves payload and supplies source-valid ${eventType}`, async () => {
  const f = await fixture()
  await f.authModule.recordAuthEmailEvent({ userId: 'user-1', email: ' User@Example.Test ', eventType, status: 'verified', source: 'callback', actorUserId: 'actor-1', companyId: 'company-1', metadata: { tokenVerified: true } })
  assert.deepEqual(f.events, [{ user_id: 'user-1', email: 'user@example.test', action: eventType, event_type: eventType, status: 'verified', source: 'callback', actor_user_id: 'actor-1', company_id: 'company-1', metadata: { tokenVerified: true } }])
})

test('auth writer retains defaults and propagates integrity errors', async () => {
  const f = await fixture()
  await f.authModule.recordAuthEmailEvent({ email: 'user@example.test', eventType: 'invite_sent' })
  assert.deepEqual(f.events[0], { user_id: null, email: 'user@example.test', action: 'invite_sent', event_type: 'invite_sent', status: 'sent', source: 'app', actor_user_id: null, company_id: null, metadata: {} })
  for (const code of ['23502', '23514', '42501']) {
    const error = { code, message: 'database rejected event' }, f = await fixture({ eventError: error })
    await assert.rejects(f.authModule.recordAuthEmailEvent({ email: 'user@example.test', eventType: 'invite_sent' }), actual => actual === error)
  }
})

for (const code of ['42P01', '42703', 'PGRST205']) test(`existing schema compatibility handling stays bounded to ${code}`, async () => {
  const f = await fixture({ eventError: { code } })
  await f.authModule.recordAuthEmailEvent({ email: 'user@example.test', eventType: 'invite_sent' })
  await f.resetModule.sendTenantBrandedPasswordResetEmail({ email: 'user@example.test' })
  assert.equal(f.events.length, 2)
})

for (const company of [true, false]) test(`password reset ${company ? 'branded' : 'fallback'} records required action after delivery`, async () => {
  const f = await fixture({ company })
  const result = await f.resetModule.sendTenantBrandedPasswordResetEmail({ email: ' User@Example.Test ', actorUserId: 'actor-1', source: 'reset-test' })
  assert.equal(result.branded, company); assert.equal(result.fallback, !company)
  assert.equal(f.sent.length, Number(company)); assert.equal(f.reset.length, Number(!company))
  assert.deepEqual(f.events, [{ user_id: 'user-1', email: 'user@example.test', action: 'password_reset_sent', event_type: 'password_reset_sent', status: 'sent', source: 'reset-test', actor_user_id: 'actor-1', company_id: company ? 'company-1' : null, metadata: company ? { branded: true } : { branded: false, reason: 'company_scope_missing' } }])
  assert.equal(f.updates.length, Number(company))
})

test('SMTP-not-ready records a failed reset action and retains failure', async () => {
  const f = await fixture({ smtpReady: false })
  await assert.rejects(f.resetModule.sendTenantBrandedPasswordResetEmail({ email: 'user@example.test' }), /SMTP unavailable/)
  assert.deepEqual(f.events[0], { user_id: 'user-1', email: 'user@example.test', action: 'password_reset_sent', event_type: 'password_reset_sent', status: 'failed', source: 'tenant_password_reset', actor_user_id: null, company_id: 'company-1', metadata: { branded: true, reason: 'auth_smtp_not_ready', missing: ['SMTP_HOST'] } })
  assert.equal(f.sent.length + f.reset.length + f.updates.length, 0)
})

test('reset event integrity errors remain failures after branded or fallback delivery', async () => {
  for (const company of [true, false]) for (const code of ['23502', '23514', '42501']) {
    const error = { code, message: 'database rejected event' }, f = await fixture({ company, eventError: error })
    await assert.rejects(f.resetModule.sendTenantBrandedPasswordResetEmail({ email: 'user@example.test' }), actual => actual === error)
    assert.equal(f.updates.length, 0)
  }
})
