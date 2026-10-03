import type { NextRequest } from 'next/server'
import { staffSessionHandler } from '@/lib/staff-api/sessions'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export async function POST(request: NextRequest) { return staffSessionHandler(request, 'logout') }
