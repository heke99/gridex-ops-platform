import { NextResponse } from 'next/server'
import { requireAdminApiAccess } from '@/lib/admin/apiGuards'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ id: string }> }

export async function POST(_request: Request, { params }: Props) {
  await params
  const access = await requireAdminApiAccess(['billing.write'])
  if (access.response) return access.response
  return NextResponse.json({ error: 'Kreditfaktura kräver separat kreditunderlag och är därför blockerad tills kreditflödet är aktiverat.' }, { status: 409 })
}
