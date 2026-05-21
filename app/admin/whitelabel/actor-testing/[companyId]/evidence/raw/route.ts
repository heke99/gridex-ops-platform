import { isPlatformAdminContext, requireAdminAccess } from '@/lib/admin/guards'
import { buildActorTestingEvidencePackage } from '@/lib/ediel/actorTestingEngine'
import { userCanManageActorTestingForCompany } from '@/lib/ediel/actorTesting'

export const dynamic = 'force-dynamic'

export async function GET(_request: Request, context: { params: Promise<{ companyId: string }> }) {
  const admin = await requireAdminAccess()
  const { companyId } = await context.params
  const allowed = await userCanManageActorTestingForCompany(admin.userId, companyId, isPlatformAdminContext(admin))
  if (!allowed) return new Response('Forbidden', { status: 403 })

  const pkg = await buildActorTestingEvidencePackage(companyId)
  const filename = `actor-testing-evidence-${pkg.company.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${new Date().toISOString().slice(0, 10)}.json`
  return Response.json(pkg, {
    headers: {
      'content-disposition': `attachment; filename="${filename}"`,
    },
  })
}
