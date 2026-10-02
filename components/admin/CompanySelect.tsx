import { listPlatformCompanies } from '@/lib/tenant/scope'

/** Platform-only company picker; replaces free-text company_id inputs. */
export default async function CompanySelect({
  name = 'company_id',
  defaultValue = '',
  emptyLabel,
  className = 'mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm',
}: {
  name?: string
  defaultValue?: string | null
  emptyLabel: string
  className?: string
}) {
  const companies = await listPlatformCompanies()
  return (
    <select name={name} defaultValue={defaultValue ?? ''} className={className}>
      <option value="">{emptyLabel}</option>
      {companies.map((company) => (
        <option key={company.id} value={company.id}>
          {company.name}
          {company.org_number ? ` (${company.org_number})` : ''}
        </option>
      ))}
    </select>
  )
}
