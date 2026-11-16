import Link from 'next/link'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import {
 getElectricitySupplierById,
 listElectricitySuppliers,
} from '@/lib/masterdata/db'
import ElectricitySupplierForm from '@/components/admin/masterdata/ElectricitySupplierForm'
import ElectricitySuppliersTable from '@/components/admin/masterdata/ElectricitySuppliersTable'

export const dynamic = 'force-dynamic'

type PageProps = {
 searchParams?: Promise<{
 edit?: string
 }>
}

export default async function ElectricitySuppliersPage({
 searchParams,
}: PageProps) {
 await requirePlatformAdminAccess()

 const supabase = await createSupabaseServerClient()
 const params = await searchParams
 const editId = params?.edit

 const [suppliers, editingSupplier] = await Promise.all([
 listElectricitySuppliers(supabase),
 editId ? getElectricitySupplierById(supabase, editId) : Promise.resolve(null),
 ])

 const activeCount = suppliers.filter((supplier) => supplier.is_active).length

 return (
 <div className="space-y-6">
 <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm ">
 <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
 <div>
 <p className="text-sm font-medium text-slate-700 ">
 Masterdata
 </p>
 <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950 ">
 Elleverantörer
 </h1>
 <p className="mt-2 max-w-3xl text-sm text-slate-700 ">
 Permanent register över elleverantörer. Dessa kan användas i switchflödet och
 uppdateras centralt så att kundkorten återanvänder samma uppgifter nästa gång.
 </p>
 </div>

 <div className="flex flex-wrap gap-3">
 <Link
 href="/admin/electricity-suppliers"
 className="inline-flex items-center rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 "
 >
 Ny elleverantör
 </Link>
 <Link
 href="/admin/customers"
 className="inline-flex items-center rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 "
 >
 Till kunder
 </Link>
 </div>
 </div>

 <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
 <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm ">
 <div className="text-slate-700 ">Antal leverantörer</div>
 <div className="mt-1 text-xl font-semibold text-slate-950 ">
 {suppliers.length}
 </div>
 </div>
 <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm ">
 <div className="text-slate-700 ">Aktiva</div>
 <div className="mt-1 text-xl font-semibold text-slate-950 ">
 {activeCount}
 </div>
 </div>
 <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm ">
 <div className="text-slate-700 ">Redigeringsläge</div>
 <div className="mt-1 text-xl font-semibold text-slate-950 ">
 {editingSupplier ? editingSupplier.name : 'Nej'}
 </div>
 </div>
 </div>
 </section>

 <section className="rounded-3xl border border-amber-200 bg-amber-50 p-6 text-sm leading-6 text-amber-950 shadow-sm">
 <h2 className="text-lg font-semibold text-slate-950">Endast platform/teknisk admin ändrar elleverantörer</h2>
 <p className="mt-2">Tenant-admins ska välja verifierade aktörer i kundflöden. Tekniska fält som Ediel-id, subadress, certifikat, transportkanal och produktions-/testmiljö ska hanteras centralt så att ett elbolag inte råkar skapa felaktig route eller osäker mottagare.</p>
 </section>

 <div className="grid gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
 <ElectricitySupplierForm supplier={editingSupplier} />
 <ElectricitySuppliersTable suppliers={suppliers} />
 </div>
 </div>
 )
}