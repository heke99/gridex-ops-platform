import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { psql, psqlRows, serviceClient } from './db'

export type FixtureActorObservation = {
  userId: string; companyId: string; observedAt: string
  authActive: boolean; profileActive: boolean; companyActive: boolean; membershipActive: boolean
  roleKeys: string[]; rolePermissionKeys: string[]
}

export type AdminFixture = {
  companyId: string
  userId: string
  email: string
  /** Genererat lokalt för denna fixture; skrivs aldrig till logg. */
  password: string
  permissionKeys: string[]
  purpose?: 'PLATFORM_CONFIGURATION'
  /** Observed SQL fixture state, not ordinary signup or authenticated permission proof. */
  observedFixture?: FixtureActorObservation
}

const sqlLit = (v: string) => `'${v.replace(/'/g, "''")}'`
const actors = new Map<string, AdminFixture>()

export type PilotTestAuthority = {
  declaration: 'TEST_TRUST_BOOTSTRAP_NOT_LEGAL_ACCEPTANCE'; specificationSha256: string
  authoritySourceSha256: string; validFrom: string; validTo: string
  regulatedIssuerCode: string; regulatedReference: string; regulatedKeyHex: string
  networkRegistryVersion: string; networkReference: string; networkKeyHex: string
}

/** Administrative synthetic verifier configuration ONLY. No source, approval,
 * customer, supply, message, metering or invoice row is produced here. Caller
 * must first verify signed runtime/material specification and admitted DB.
 * Ordinary archive + independent authenticated review remain mandatory. */
export function bootstrapPilotTestTrust(input: { companyId: string; actorUserId: string; receiver: string; authority: PilotTestAuthority }) {
  const { authority: a, companyId: company, actorUserId: actor } = input
  if (process.env.SIM_REQUIRE_ACTOR_RECEIPT !== '1' || a.declaration !== 'TEST_TRUST_BOOTSTRAP_NOT_LEGAL_ACCEPTANCE'
    || !/^[a-f0-9]{64}$/.test(a.specificationSha256) || !/^[a-f0-9]{64}$/.test(a.authoritySourceSha256)
    || [a.regulatedKeyHex, a.networkKeyHex].some(v => !/^(?:[a-f0-9]{2}){32,}$/.test(v))
    || !(Date.parse(a.validFrom) < Date.now() && Date.now() < Date.parse(a.validTo))) throw Error('pilot_test_authority_specification_invalid')
  const observation = observeFixtureActor(actor, company)
  if (!observation.authActive || !observation.companyActive || !observation.membershipActive) throw Error('pilot_catalog_actor_unverified')
  const rows = psqlRows<{ legal: string; dso: string }>(`SELECT t.actor_id AS legal,p.actor_id AS dso FROM public.tenant_actor_identifiers t JOIN public.platform_actor_identifiers p ON p.identifier_value=${sqlLit(input.receiver)} AND p.identifier_type='EdielId' AND p.is_verified WHERE t.company_id=${sqlLit(company)} AND t.environment='test' AND t.identifier_type='EdielId'`)
  if (rows.length !== 1) throw Error('pilot_catalog_actor_tuple_ambiguous')
  const { legal, dso } = rows[0], agreementId = randomUUID(), regulatedKeyId = randomUUID(), regulatedRepresentationId = randomUUID(), networkKeyId = randomUUID(), networkRepresentationId = randomUUID()
  try { psql(`BEGIN;
    SELECT pg_advisory_xact_lock(hashtextextended(${sqlLit('t2-pilot-test-trust:' + company)},0));
    INSERT INTO public.tenant_bilateral_agreements(id,company_id,environment,counterparty_actor_id,capability_code,terms,is_enabled,valid_from,valid_to,source_reference)
      VALUES(${sqlLit(agreementId)},${sqlLit(company)},'test',${sqlLit(dso)},'PRODAT:Z04:A','{"declaration":"TEST_TRUST_BOOTSTRAP_NOT_LEGAL_ACCEPTANCE"}',true,${sqlLit(a.validFrom)},${sqlLit(a.validTo)},${sqlLit(a.regulatedReference)});
    INSERT INTO gridex_regulated_supply.issuer_keys(id,company_id,environment,issuer_code,legal_issuer_reference,legal_authority_source_hash,receipt_signing_key,valid_from,valid_to)
      VALUES(${sqlLit(regulatedKeyId)},${sqlLit(company)},'test',${sqlLit(a.regulatedIssuerCode)},${sqlLit(a.regulatedReference)},${sqlLit(a.authoritySourceSha256)},decode(${sqlLit(a.regulatedKeyHex)},'hex'),${sqlLit(a.validFrom)},${sqlLit(a.validTo)});
    INSERT INTO gridex_regulated_supply.issuer_representations(id,company_id,environment,issuer_key_id,legal_actor_id,dso_actor_id,grid_area_code,permitted_kind,bilateral_agreement_id,legal_representation_reference,legal_authority_source_hash,valid_from,valid_to)
      VALUES(${sqlLit(regulatedRepresentationId)},${sqlLit(company)},'test',${sqlLit(regulatedKeyId)},${sqlLit(legal)},${sqlLit(dso)},'TES','assigned_supply',${sqlLit(agreementId)},${sqlLit(a.regulatedReference)},${sqlLit(a.authoritySourceSha256)},${sqlLit(a.validFrom)},${sqlLit(a.validTo)});
    INSERT INTO gridex_network_registry_sources.issuer_keys(id,company_id,environment,network_actor_id,registry_version,legal_authority_reference,legal_authority_hash,receipt_signing_key,valid_from,valid_to)
      VALUES(${sqlLit(networkKeyId)},${sqlLit(company)},'test',${sqlLit(dso)},${sqlLit(a.networkRegistryVersion)},${sqlLit(a.networkReference)},${sqlLit(a.authoritySourceSha256)},decode(${sqlLit(a.networkKeyHex)},'hex'),${sqlLit(a.validFrom)},${sqlLit(a.validTo)});
    INSERT INTO gridex_network_registry_sources.representations(id,company_id,environment,issuer_key_id,network_actor_id,legal_authority_reference,legal_authority_hash,valid_from,valid_to)
      VALUES(${sqlLit(networkRepresentationId)},${sqlLit(company)},'test',${sqlLit(networkKeyId)},${sqlLit(dso)},${sqlLit(a.networkReference)},${sqlLit(a.authoritySourceSha256)},${sqlLit(a.validFrom)},${sqlLit(a.validTo)});
    COMMIT;`) } catch { throw Error('pilot_catalog_bootstrap_unconfirmed_no_retry') }
  // Read actual scoped tuples and key HASHES; never export private keys.
  const observed = psqlRows<Record<string, unknown>>(`SELECT a.id AS agreement,r.id AS regulated_key,rr.id AS regulated_representation,n.id AS network_key,nr.id AS network_representation,
    a.company_id,a.environment,a.counterparty_actor_id,r.issuer_code,rr.legal_actor_id,rr.dso_actor_id,rr.permitted_kind,rr.bilateral_agreement_id,n.network_actor_id,n.registry_version,
    r.legal_authority_source_hash,n.legal_authority_hash,encode(sha256(r.receipt_signing_key),'hex') AS regulated_key_hash,encode(sha256(n.receipt_signing_key),'hex') AS network_key_hash
    FROM public.tenant_bilateral_agreements a JOIN gridex_regulated_supply.issuer_keys r ON r.company_id=a.company_id AND r.id=${sqlLit(regulatedKeyId)}
    JOIN gridex_regulated_supply.issuer_representations rr ON rr.company_id=a.company_id AND rr.id=${sqlLit(regulatedRepresentationId)} AND rr.issuer_key_id=r.id
    JOIN gridex_network_registry_sources.issuer_keys n ON n.company_id=a.company_id AND n.id=${sqlLit(networkKeyId)}
    JOIN gridex_network_registry_sources.representations nr ON nr.company_id=a.company_id AND nr.id=${sqlLit(networkRepresentationId)} AND nr.issuer_key_id=n.id
    WHERE a.company_id=${sqlLit(company)} AND a.id=${sqlLit(agreementId)}`)
  const expected: Record<string, unknown> = { agreement: agreementId, regulated_key: regulatedKeyId, regulated_representation: regulatedRepresentationId,
    network_key: networkKeyId, network_representation: networkRepresentationId, company_id: company, environment: 'test', counterparty_actor_id: dso,
    issuer_code: a.regulatedIssuerCode, legal_actor_id: legal, dso_actor_id: dso, permitted_kind: 'assigned_supply', bilateral_agreement_id: agreementId,
    network_actor_id: dso, registry_version: a.networkRegistryVersion, legal_authority_source_hash: a.authoritySourceSha256, legal_authority_hash: a.authoritySourceSha256,
    regulated_key_hash: createHash('sha256').update(Buffer.from(a.regulatedKeyHex, 'hex')).digest('hex'), network_key_hash: createHash('sha256').update(Buffer.from(a.networkKeyHex, 'hex')).digest('hex') }
  if (observed.length !== 1 || Object.entries(expected).some(([k, v]) => observed[0][k] !== v)) throw Error('pilot_catalog_readback_mismatch')
  return { state: a.declaration, companyId: company, agreementId, regulatedKeyId, regulatedRepresentationId, networkKeyId, networkRepresentationId,
    networkActorId: dso, specificationSha256: a.specificationSha256, observedAt: new Date().toISOString(),
    observedRowsSha256: createHash('sha256').update(JSON.stringify(observed)).digest('hex') }
}

export function fixtureActorExpectation(email: string): Pick<AdminFixture, 'userId' | 'companyId' | 'permissionKeys' | 'purpose'> {
  const actor = actors.get(email)
  if (!actor) throw new Error('actor_fixture_identity_not_registered')
  return { userId: actor.userId, companyId: actor.companyId, permissionKeys: [...actor.permissionKeys], ...(actor.purpose ? { purpose: actor.purpose } : {}) }
}

/** Read actual tenant-scoped fixture state; the authenticated resolver remains authoritative for DENY/effective access. */
export function observeFixtureActor(userId: string, companyId: string): FixtureActorObservation {
  let rows: Omit<FixtureActorObservation, 'observedAt'>[]
  try { rows = psqlRows<Omit<FixtureActorObservation, 'observedAt'>>(`
    SELECT u.id AS "userId",c.id AS "companyId",
      (u.deleted_at IS NULL AND u.email_confirmed_at IS NOT NULL AND (u.banned_until IS NULL OR u.banned_until<=clock_timestamp())) AS "authActive",
      (profile.user_status='active') AS "profileActive",
      (c.status='active' AND c.lifecycle_status='active' AND c.is_active AND c.archived_at IS NULL AND c.suspended_at IS NULL) AS "companyActive",
      EXISTS(SELECT 1 FROM public.company_memberships membership WHERE membership.user_id=u.id AND membership.company_id=c.id
        AND membership.status='active' AND coalesce(membership.is_active,true)) AS "membershipActive",
      coalesce((SELECT jsonb_agg(DISTINCT role.key) FROM public.user_roles ur JOIN public.roles role ON role.id=ur.role_id
        WHERE ur.user_id=u.id AND ur.company_id=c.id AND coalesce(ur.status,'active')='active' AND coalesce(ur.is_active,true)
          AND coalesce(role.is_active,true)),'[]'::jsonb) AS "roleKeys",
      coalesce((SELECT jsonb_agg(DISTINCT permission.key) FROM public.user_roles ur JOIN public.roles role ON role.id=ur.role_id
        JOIN public.role_permissions grant_row ON grant_row.role_id=role.id JOIN public.permissions permission ON permission.id=grant_row.permission_id
        WHERE ur.user_id=u.id AND ur.company_id=c.id AND coalesce(ur.status,'active')='active' AND coalesce(ur.is_active,true)
          AND coalesce(role.is_active,true) AND permission.is_active AND coalesce(grant_row.effect,'allow')='allow'),'[]'::jsonb) AS "rolePermissionKeys"
    FROM auth.users u JOIN public.user_profiles profile ON profile.id=u.id
    JOIN public.companies c ON c.id=${sqlLit(companyId)} WHERE u.id=${sqlLit(userId)}`) }
  catch { throw new Error('actor_fixture_observation_failed') }
  const row = rows[0]
  if (rows.length !== 1 || row.userId !== userId || row.companyId !== companyId
    || !Array.isArray(row.roleKeys) || !row.roleKeys.every(key => typeof key === 'string')
    || !Array.isArray(row.rolePermissionKeys) || !row.rolePermissionKeys.every(key => typeof key === 'string')) {
    throw new Error('actor_fixture_observation_unqualified')
  }
  // Explicit projection excludes raw Auth rows, email, hashes and credential fields.
  return { userId, companyId, observedAt: new Date().toISOString(), authActive: row.authActive === true, profileActive: row.profileActive === true,
    companyActive: row.companyActive === true, membershipActive: row.membershipActive === true,
    roleKeys: [...new Set(row.roleKeys)].sort(), rolePermissionKeys: [...new Set(row.rolePermissionKeys)].sort() }
}

/**
 * Syntetisk auth-användare (via GoTrue admin-API, så att lösenordsinloggning fungerar) + ett eget
 * företag med company_admin-medlemskap och explicita user_permissions.
 * Mönster (rader och kolumner) från scripts/helpers/staff-write-native-fixture.ts @ 1c0c088c.
 */
export async function createAdminFixture(opts: { permissionKeys?: string[]; companyName?: string; existingCompanyId?: string; purpose?: 'PLATFORM_CONFIGURATION' } = {}): Promise<AdminFixture> {
  const permissionKeys = [...new Set(opts.permissionKeys ?? ['billing_underlay.read', 'billing_underlay.export'])]
  const hosted = process.env.SIM_REQUIRE_ACTOR_RECEIPT === '1'
  if (opts.purpose && !hosted) throw new Error('platform_configuration_fixture_requires_hosted_profile')
  if (opts.purpose) {
    const { requirePlatformConfigurationRuntime } = await import('./session')
    requirePlatformConfigurationRuntime()
  }
  const companyId = opts.existingCompanyId ?? randomUUID()
  if (opts.existingCompanyId) {
    if (!/^[a-f0-9-]{36}$/.test(companyId) || !hosted) throw new Error('actor_existing_company_requires_hosted_profile')
    const companies = psqlRows<{ id: string }>(`SELECT id FROM public.companies WHERE id=${sqlLit(companyId)} AND status='active' AND lifecycle_status='active' AND is_active AND archived_at IS NULL AND suspended_at IS NULL`)
    if (companies.length !== 1 || companies[0].id !== companyId) throw new Error('actor_existing_company_unverified')
  }
  const email = `sim-admin-${companyId.slice(0, 8)}${opts.existingCompanyId ? '-' + randomBytes(4).toString('hex') : ''}@example.invalid`
  const password = `Sim-${randomBytes(12).toString('hex')}!`

  const { data, error } = await serviceClient().auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { synthetic: true },
  }).catch(error => {
    if (hosted) throw new Error('actor_fixture_auth_creation_failed')
    throw error
  })
  if (error || !data.user) throw new Error(hosted
    ? 'actor_fixture_auth_creation_failed' : `createUser misslyckades: ${error?.message ?? 'ingen användare'}`)
  const userId = data.user.id

  const keys = permissionKeys.map(sqlLit).join(',')
  const roleId = hosted ? randomUUID() : null
  const roleKey = `sim_actor_${roleId}`
  try { psql(`BEGIN;
    ${opts.existingCompanyId ? '' : `INSERT INTO public.companies(id,name,status) VALUES('${companyId}',${sqlLit(opts.companyName ?? 'Synthetic sim company')},'active');`}
    INSERT INTO public.user_profiles(id,email,full_name,user_status) VALUES('${userId}',${sqlLit(email)},'Synthetic sim admin','active')
      ON CONFLICT(id) DO UPDATE SET user_status='active', email=excluded.email;
    INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,is_active,accepted_at,joined_at,role,role_key)
      VALUES('${companyId}','${userId}','company_admin','active',true,now(),now(),'company_admin','company_admin');
    ${opts.purpose === 'PLATFORM_CONFIGURATION' ? `INSERT INTO public.admin_users(user_id,role,is_active) VALUES('${userId}','platform_admin',true);` : ''}
    ${keys ? `INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key)
      SELECT '${userId}','${companyId}',id,key FROM public.permissions WHERE key IN(${keys});` : ''}
    ${hosted ? `INSERT INTO public.roles(id,key,name,scope,is_active)
      VALUES('${roleId}',${sqlLit(roleKey)},'Disposable hosted synthetic actor','company',true);
      INSERT INTO public.user_roles(user_id,company_id,role_id,role,status,is_active)
      VALUES('${userId}','${companyId}','${roleId}',${sqlLit(roleKey)},'active',true);
      ${keys ? `INSERT INTO public.role_permissions(role_id,role_key,permission_id,permission_key,effect)
        SELECT '${roleId}',${sqlLit(roleKey)},id,key,'allow' FROM public.permissions WHERE key IN(${keys});` : ''}` : ''}
    COMMIT;`) } catch (error) {
    if (hosted) throw new Error('actor_fixture_setup_unconfirmed')
    throw error
  }
  const fixture: AdminFixture = { companyId, userId, email, password, permissionKeys, ...(opts.purpose ? { purpose: opts.purpose } : {}) }
  if (hosted) {
    fixture.observedFixture = observeFixtureActor(userId, companyId)
    Object.defineProperty(fixture, 'password', { value: password, enumerable: false })
  }
  actors.set(email, fixture)
  return fixture
}

/** Best effort; stacken är ändå tillfällig. */
export async function removeAdminFixtureUser(f: AdminFixture): Promise<void> {
  actors.delete(f.email)
  await serviceClient().auth.admin.deleteUser(f.userId).catch(() => undefined)
}
