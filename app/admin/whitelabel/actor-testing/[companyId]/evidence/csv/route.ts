import { isPlatformAdminContext, requireAdminAccess } from '@/lib/admin/guards'
import { buildActorTestingEvidencePackage, renderActorTestingEvidenceCsv } from '@/lib/ediel/actorTestingEngine'
import { userCanManageActorTestingForCompany } from '@/lib/ediel/actorTesting'

export const dynamic = 'force-dynamic'

function evidenceSlug(name: string | null | undefined, fallback: string) {
  return (name?.trim() || fallback).replace(/[^a-z0-9]+/gi, '-').toLowerCase()
}

export async function GET(_request: Request, context: { params: Promise<{ companyId: string }> }) {
  const admin = await requireAdminAccess()
  const { companyId } = await context.params
  const allowed = await userCanManageActorTestingForCompany(admin.userId, companyId, isPlatformAdminContext(admin))
  if (!allowed) return new Response('Forbidden', { status: 403 })

  const pkg = await buildActorTestingEvidencePackage(companyId)
  const csv = renderActorTestingEvidenceCsv(pkg)
  const filename = `actor-testing-evidence-${evidenceSlug(pkg.company.name, companyId)}-${new Date().toISOString().slice(0, 10)}.csv`
  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
    },
  })
}
