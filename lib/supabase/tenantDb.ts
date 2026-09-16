import { supabaseService } from '@/lib/supabase/service'

/**
 * F-15: a tenant-bound wrapper around the service-role client.
 *
 * The application runs on `service_role`, which holds `rolbypassrls`. Every
 * restrictive policy in the database is therefore inert for application traffic,
 * and tenant isolation rests on 444 files each remembering `.eq('company_id', …)`.
 * Discipline does not scale to 444 files, and a single omission is a cross-tenant
 * read.
 *
 * `tenantDb(companyId)` removes the opportunity to forget: the company predicate
 * is applied by the wrapper, inserts are stamped with it, and updates cannot
 * change it. A query built here cannot be constructed without a company. Callers
 * remain responsible for resolving an authorized company before construction.
 *
 * This is the migration path, not the destination. The destination is a database
 * role without BYPASSRLS so the policies do the work; see
 * quality/audits/TENANT_TARGET_ARCHITECTURE_AND_REGISTER_2026-09-02.md, layer 4.
 * Until then, new code uses this and the ratchet in
 * scripts/check-service-role-tenant-ratchet.cjs stops the direct-call count from
 * growing.
 */

function requireCompanyId(companyId: string | null | undefined): string {
  const normalized = companyId?.trim()
  if (!normalized) {
    throw new Error(
      'Bolag krävs för en tenantbunden databasfråga. Använd inte service-role-klienten direkt för tenantdata.',
    )
  }
  return normalized
}

type ServiceClient = typeof supabaseService
type ServiceTable = ReturnType<ServiceClient['from']>

export type TenantScopedTable = {
  /** SELECT, already filtered to this company. */
  select: (columns?: string, options?: Parameters<ServiceTable['select']>[1]) => unknown
  /** INSERT, with company_id stamped onto every row. */
  insert: (values: Record<string, unknown> | Record<string, unknown>[]) => unknown
  /** UPDATE, already filtered to this company. */
  update: (values: Record<string, unknown>) => unknown
  /** DELETE, already filtered to this company. */
  delete: () => unknown
  /**
   * Unsupported until the table and a company-qualified conflict target have
   * been audited together.
   */
  upsert: (
    values: Record<string, unknown> | Record<string, unknown>[],
    options?: Parameters<ServiceTable['upsert']>[1],
  ) => unknown
}

export type TenantScopedDb = {
  readonly companyId: string
  from: (table: string) => TenantScopedTable
  /**
   * Escape hatch for the genuinely cross-tenant paths -- platform admin tooling,
   * provisioning, market data imports. Naming it explicitly keeps those callers
   * visible in review instead of indistinguishable from an accidental omission.
   */
  unscoped: () => ServiceClient
}

function stampCompany(
  values: Record<string, unknown> | Record<string, unknown>[],
  companyId: string,
) {
  if (Array.isArray(values)) {
    return values.map((row) => ({ ...row, company_id: companyId }))
  }
  return { ...values, company_id: companyId }
}

function prepareUpdate(values: Record<string, unknown>, companyId: string) {
  const copiedValues = { ...values }

  if (Object.prototype.hasOwnProperty.call(copiedValues, 'company_id')) {
    if (copiedValues.company_id !== companyId) {
      throw new Error('company_id i en tenantbunden uppdatering måste matcha det valda bolaget.')
    }
    delete copiedValues.company_id
  }

  return copiedValues
}

export function tenantDb(companyId: string | null | undefined): TenantScopedDb {
  const scopedCompanyId = requireCompanyId(companyId)

  return {
    companyId: scopedCompanyId,

    from(table: string): TenantScopedTable {
      const base = () => supabaseService.from(table)

      return {
        select: (columns = '*', options) =>
          base().select(columns, options).eq('company_id', scopedCompanyId),

        insert: (values) => base().insert(stampCompany(values, scopedCompanyId)),

        upsert: () => {
          throw new Error(
            'Generisk tenantbunden upsert stöds inte utan en tabellspecifik, granskad konfliktdefinition.',
          )
        },

        update: (values) => {
          const copiedValues = prepareUpdate(values, scopedCompanyId)
          return base().update(copiedValues).eq('company_id', scopedCompanyId)
        },

        delete: () => base().delete().eq('company_id', scopedCompanyId),
      }
    },

    unscoped: () => supabaseService,
  }
}
