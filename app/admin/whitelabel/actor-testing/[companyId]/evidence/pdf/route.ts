import { isPlatformAdminContext, requireAdminAccess } from '@/lib/admin/guards'
import { userCanManageActorTestingForCompany } from '@/lib/ediel/actorTesting'
import { buildActorTestingEvidencePackage, renderActorTestingEvidencePdf } from '@/lib/ediel/actorTestingEngine'

export const dynamic = 'force-dynamic'

function toResponseBody(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return buffer
}

export async function GET(_request: Request, context: { params: Promise<{ companyId: string }> }) {
  const admin = await requireAdminAccess()
  const { companyId } = await context.params
  const allowed = await userCanManageActorTestingForCompany(admin.userId, companyId, isPlatformAdminContext(admin))
  if (!allowed) return new Response('Forbidden', { status: 403 })

  const pkg = await buildActorTestingEvidencePackage(companyId)
  const pdf = renderActorTestingEvidencePdf(pkg)
  const filename = `actor-testing-evidence-${pkg.company.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${new Date().toISOString().slice(0, 10)}.pdf`
  return new Response(toResponseBody(pdf), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="${filename}"`,
    },
  })
}
