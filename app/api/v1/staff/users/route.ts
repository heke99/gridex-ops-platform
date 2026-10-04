import { getStaffUsers, postStaffUser } from '@/lib/staff-api/userHandlers'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const GET = getStaffUsers
export const POST = postStaffUser
