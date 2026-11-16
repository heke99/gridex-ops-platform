import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { buildActorTestingEvidencePackage } from '@/lib/ediel/actorTestingEngine'

export const dynamic = 'force-dynamic'

function evidenceSlug(name: string | null | undefined, fallback: string) {
  return (name?.trim() || fallback).replace(/[^a-z0-9]+/gi, '-').toLowerCase()
}

export async function GET(_request: Request, context: { params: Promise<{ companyId: string }> }) {
  await requirePlatformAdminAccess()
  const { companyId } = await context.params
  const pkg = await buildActorTestingEvidencePackage(companyId)
  const filename = `actor-testing-evidence-${evidenceSlug(pkg.company.name, companyId)}-${new Date().toISOString().slice(0, 10)}.json`
  return Response.json(pkg, {
    headers: {
      'content-disposition': `attachment; filename="${filename}"`,
    },
  })
}
