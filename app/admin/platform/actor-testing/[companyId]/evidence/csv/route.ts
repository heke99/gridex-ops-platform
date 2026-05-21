import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { buildActorTestingEvidencePackage, renderActorTestingEvidenceCsv } from '@/lib/ediel/actorTestingEngine'

export const dynamic = 'force-dynamic'

export async function GET(_request: Request, context: { params: Promise<{ companyId: string }> }) {
  await requirePlatformAdminAccess()
  const { companyId } = await context.params
  const pkg = await buildActorTestingEvidencePackage(companyId)
  const csv = renderActorTestingEvidenceCsv(pkg)
  const filename = `actor-testing-evidence-${pkg.company.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv`
  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
    },
  })
}
