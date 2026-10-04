import type { NextRequest } from 'next/server'
import { staffMeHandler } from '@/lib/staff-api/sessions'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export async function GET(request: NextRequest) { return staffMeHandler(request) }
