// app/admin/metering/page.tsx
import AdminHeader from '@/components/admin/AdminHeader'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requirePermissionServer } from '@/lib/auth/requirePermissionServer'
import {
  listAllGridOwnerDataRequests,
  listAllMeteringValues,
} from '@/lib/cis/db'
import {
  MeteringFilterBar,
  MeteringRequestsSection,
  MeteringIngestForm,
  MeteringValuesTable,
} from './_components'

export const dynamic = 'force-dynamic'

type PageProps = {
  searchParams: Promise<{
    q?: string
  }>
}

export default async function AdminMeteringPage({ searchParams }: PageProps) {
  await requirePermissionServer('metering.read')

  const params = await searchParams
  const query = (params.q ?? '').trim()

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const [requests, values] = await Promise.all([
    listAllGridOwnerDataRequests({
      status: 'all',
      scope: 'meter_values',
      query,
    }),
    listAllMeteringValues({
      query,
    }),
  ])

  return (
    <div className="min-h-screen">
      <AdminHeader
        title="Metering"
        subtitle="Mätvärdesrequests mot nätägare, ingest och översikt över inkomna värden."
        userEmail={user?.email ?? null}
      />

      <div className="space-y-6 p-8">
        <MeteringFilterBar query={query} />

        <section className="grid gap-6 xl:grid-cols-[minmax(0,1.05fr)_420px]">
          <MeteringRequestsSection requests={requests} />
          <MeteringIngestForm />
        </section>

        <MeteringValuesTable values={values} />
      </div>
    </div>
  )
}