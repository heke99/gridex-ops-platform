// Canonical API-channel endpoint. /api/v1/contracts remains a compatibility
// alias and shares this exact handler. Route config is declared locally so
// Next.js can statically recognize it during the production build.
import { GET as contractsGET } from '@/app/api/v1/contracts/route'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const GET = contractsGET
