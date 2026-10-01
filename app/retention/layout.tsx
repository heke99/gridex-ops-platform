import {cookies} from 'next/headers'
import Link from 'next/link'
import {requireRetentionCompanies,RETENTION_SELECTED_COMPANY_COOKIE} from '@/lib/ediel/retention/retentionHttp'
import {leaveRetentionWorkspace} from './actions'
import CompanySelector from './company-selector'
export const dynamic='force-dynamic'
export default async function RetentionLayout({children}:{children:React.ReactNode}){
 let companies:Awaited<ReturnType<typeof requireRetentionCompanies>>['companies']|null=null
 try{companies=(await requireRetentionCompanies()).companies}catch{companies=null}
 if(!companies)return <main className="mx-auto max-w-3xl p-6"><h1 className="text-2xl font-semibold">Behörig gallring</h1><p role="alert" className="my-4">Logga in med ett aktuellt eget medlemskap och uttrycklig klassbehörighet för att öppna underlagen.</p><Link href="/login" className="underline">Logga in</Link></main>
 const candidate=(await cookies()).get(RETENTION_SELECTED_COMPANY_COOKIE)?.value,selected=companies.some(c=>c.companyId===candidate)?candidate!:null
 return <div className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6"><header className="flex flex-wrap items-center justify-between gap-4"><h1 className="text-xl font-semibold">Behörig gallring</h1><form action={leaveRetentionWorkspace}><button className="rounded border px-3 py-2">Logga ut</button></form></header><CompanySelector companies={companies} selected={selected}/><nav aria-label="Gallringsunderlag" className="flex flex-wrap gap-4"><Link href="/retention/customer-records" className="underline">Avtal och kundjournal</Link><Link href="/retention/message-content" className="underline">Ediel-innehåll och transportarkiv</Link></nav>{companies.length===0?<p role="alert">Inget eget bolag har aktuell uttrycklig retention- och klassbehörighet.</p>:children}</div>
}
