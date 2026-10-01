import { supabaseService } from '@/lib/supabase/service'
import { tenantDb } from '@/lib/supabase/tenantDb'

type ServiceTable = ReturnType<typeof supabaseService.from>
export type TenantSelectQuery = ReturnType<ServiceTable['select']>
export type TenantUpdateQuery = ReturnType<ServiceTable['update']>
export type TenantInsertQuery = ReturnType<ServiceTable['insert']>

/** Typed company-filtered SELECT through tenantDb (see lib/supabase/tenantDb.ts). */
export function tenantSelect(
  companyId: string,
  table: string,
  columns = '*',
  options?: { count?: 'exact' | 'planned' | 'estimated'; head?: boolean },
): TenantSelectQuery {
  return tenantDb(companyId).from(table).select(columns, options) as TenantSelectQuery
}

/** Typed company-filtered UPDATE through tenantDb. */
export function tenantUpdate(companyId: string, table: string, values: Record<string, unknown>): TenantUpdateQuery {
  return tenantDb(companyId).from(table).update(values) as TenantUpdateQuery
}

/** Typed INSERT with company_id stamped through tenantDb. */
export function tenantInsert(companyId: string, table: string, values: Record<string, unknown> | Record<string, unknown>[]): TenantInsertQuery {
  return tenantDb(companyId).from(table).insert(values) as TenantInsertQuery
}
