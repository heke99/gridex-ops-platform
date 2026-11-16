import { getSupportMessages, postSupportMessage } from '@/lib/customer-service/supportApiHandlers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = getSupportMessages
export const POST = postSupportMessage
