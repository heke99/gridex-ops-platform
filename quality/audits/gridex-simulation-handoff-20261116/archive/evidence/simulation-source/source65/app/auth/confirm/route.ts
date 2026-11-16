import { NextResponse } from 'next/server'
import {
  getBaseAppUrl,
  getDefaultNextPathForAuthType,
  getSafeNextPath,
  normalizeAuthEmailType,
} from '@/lib/auth/authEmailFlow'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const type = normalizeAuthEmailType(requestUrl.searchParams.get('type')) ?? 'email'
  const tokenHash = requestUrl.searchParams.get('token_hash') ?? requestUrl.searchParams.get('token') ?? ''
  const nextPath = getSafeNextPath(requestUrl.searchParams.get('next'), getDefaultNextPathForAuthType(type))

  const actionUrl = new URL('/auth/action', getBaseAppUrl())
  if (tokenHash) actionUrl.searchParams.set('token_hash', tokenHash)
  actionUrl.searchParams.set('type', type)
  actionUrl.searchParams.set('next', nextPath)

  return NextResponse.redirect(actionUrl)
}
