import { NextResponse } from 'next/server'
import { listEdielOutboxBatches, readEdielOutboxBatch } from '@/lib/ediel/outbox/batchJournal'

const headers = { 'Cache-Control': 'private, no-store' }
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i

export async function readEdielOutboxRunResponse(params:URLSearchParams,actorUserId:string,companyId:string|null) {
  const runId=params.get('run_id')
  const recent=params.get('recent')
  if ((runId===null && recent!=='1') || (runId!==null && (recent!==null || !uuid.test(runId)))) {
    return NextResponse.json({ok:false,code:'invalid_outbox_run_query'},{status:400,headers})
  }
  try {
    if (runId===null) {
      return NextResponse.json({ok:true,runs:await listEdielOutboxBatches(actorUserId,companyId)},{headers})
    }
    const result=await readEdielOutboxBatch(runId,actorUserId,companyId)
    if (!result) return NextResponse.json({ok:false,code:'ediel_outbox_run_not_found'},{status:404,headers})
    return NextResponse.json({ok:true,result},{headers})
  } catch {
    return NextResponse.json({ok:false,code:'ediel_outbox_run_unavailable'},{status:503,headers})
  }
}
