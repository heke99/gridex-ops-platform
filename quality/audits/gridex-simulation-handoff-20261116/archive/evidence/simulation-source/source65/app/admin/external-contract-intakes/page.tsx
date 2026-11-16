import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

// Legacy alias: one canonical page for customer applications.
export default async function LegacyApplicationsAliasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) params.append(key, item)
  }
  const query = params.toString()
  redirect(`/admin/website-applications${query ? `?${query}` : ''}`)
}
