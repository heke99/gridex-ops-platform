import type { ReactNode } from 'react'
import { getCompanyProductionStatus } from '@/lib/tenant/companyProductionStatus'

function tenantStatusCopy(status: string | null) {
  switch ((status ?? '').toLowerCase()) {
    case 'active':
      return { label: 'Aktiv', tone: 'border-sky-200 bg-sky-50 text-sky-800' }
    case 'onboarding':
      return { label: 'Onboarding', tone: 'border-violet-200 bg-violet-50 text-violet-800' }
    case 'paused':
      return { label: 'Pausad', tone: 'border-amber-200 bg-amber-50 text-amber-900' }
    case 'suspended':
      return { label: 'Avstängd', tone: 'border-red-200 bg-red-50 text-red-800' }
    case 'archived':
    case 'closed':
      return { label: 'Arkiverad', tone: 'border-slate-300 bg-slate-100 text-slate-700' }
    default:
      return { label: status || 'Okänd', tone: 'border-slate-300 bg-slate-50 text-slate-700' }
  }
}

export default async function CompanyStatusLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const company = await getCompanyProductionStatus(id)
  if (!company) return children

  const tenantStatus = tenantStatusCopy(company.tenantStatus)

  return (
    <>
      <div className="mx-auto mb-4 max-w-[1600px] px-4 pt-4 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-black ${tenantStatus.tone}`}>
            Tenant · {tenantStatus.label}
          </span>
          <span
            className={`inline-flex rounded-full border px-3 py-1 text-xs font-black ${
              company.productionApproved
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : 'border-slate-300 bg-slate-100 text-slate-700'
            }`}
          >
            Produktion · {company.productionApproved ? 'Godkänd' : 'Ej godkänd'}
          </span>
          <span className="text-xs font-semibold text-slate-500">
            Tenantstatus styr åtkomst och arbete i OPS. Produktionsgodkännande styr live Ediel och externa produktionsflöden.
          </span>
        </div>
      </div>
      {children}
    </>
  )
}
