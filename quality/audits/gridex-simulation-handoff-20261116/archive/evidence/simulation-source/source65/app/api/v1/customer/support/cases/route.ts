import { getSupportCases, postSupportCase } from '@/lib/customer-service/supportApiHandlers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = getSupportCases
export const POST = postSupportCase
