import {NextRequest,NextResponse} from 'next/server'
import {readRequestedChangeArtifactBytes} from '@/lib/ediel/production/requestedChangeIntake'
import {requestedChangeHttp,requestedChangeHeaders,artifactSelector} from '@/lib/ediel/production/requestedChangeHttp'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export async function GET(_request:NextRequest,{params}:{params:Promise<{artifactId:string}>}){
 return requestedChangeHttp(['communication.read','customers.read'],async guard=>{
  const artifactId=artifactSelector.parse((await params).artifactId)
  const result=await readRequestedChangeArtifactBytes({companyId:guard.companyId!,actorUserId:guard.userId,artifactId})
  const extension=result.mimeType==='application/pdf'?'pdf':result.mimeType==='application/json'?'json':'txt'
  return new NextResponse(new Uint8Array(result.bytes),{headers:{...requestedChangeHeaders,'Content-Type':result.mimeType,
    'Content-Disposition':`attachment; filename="underlag-${artifactId}.${extension}"`,'Content-Length':String(result.bytes.byteLength),ETag:`"${result.sourceHash}"`}})
 })
}
