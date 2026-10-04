import {NextRequest,NextResponse} from 'next/server'
import {readAiPurposeSourceBytes} from '@/lib/ediel/production/aiPurposeSource'
import {aiPurposeSourceHttp,aiPurposeSourceHeaders,artifactSelector} from '@/lib/ediel/production/aiPurposeSourceHttp'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export async function GET(_request:NextRequest,{params}:{params:Promise<{artifactId:string}>}){return aiPurposeSourceHttp(['communication.read','customers.read','contracts.read'],async guard=>{
 const artifactId=artifactSelector.parse((await params).artifactId),result=await readAiPurposeSourceBytes({companyId:guard.companyId!,actorUserId:guard.userId,artifactId})
 return new NextResponse(new Uint8Array(result.bytes),{headers:{...aiPurposeSourceHeaders,'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="ai-underlag-${artifactId}.pdf"`,'Content-Length':String(result.bytes.byteLength),ETag:`"${result.sourceHash}"`}})
})}
