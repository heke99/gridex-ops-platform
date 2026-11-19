// components/admin/customers/billing-metering/shared.tsx
'use client'

import type { ReactNode } from 'react'

export function SectionCard({
 title,
 description,
 children,
}: {
 title: string
 description: string
 children: ReactNode
}) {
 return (
 <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm ">
 <div className="mb-5">
 <h2 className="text-lg font-semibold text-slate-900 ">
 {title}
 </h2>
 <p className="mt-1 text-sm text-slate-700 ">
 {description}
 </p>
 </div>
 {children}
 </div>
 )
}
