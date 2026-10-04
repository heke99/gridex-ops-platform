import {NextRequest,NextResponse} from 'next/server'
import {readRegulatedSupplyGroundBytes} from '@/lib/ediel/production/regulatedSupplyGroundIntake'
import {regulatedSupplyHttp,regulatedSupplyHeaders,regulatedArtifactId} from '@/lib/ediel/production/regulatedSupplyGroundHttp'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export async function GET(_request:NextRequest,{params}:{params:Promise<{artifactId:string}>}){return regulatedSupplyHttp(['communication.read','contracts.read','metering.read'],async guard=>{
 const artifactId=regulatedArtifactId.parse((await params).artifactId),result=await readRegulatedSupplyGroundBytes({companyId:guard.companyId!,actorUserId:guard.userId,artifactId})
 const extension=result.mimeType==='application/pdf'?'pdf':result.mimeType==='application/json'?'json':'txt'
 return new NextResponse(new Uint8Array(result.bytes),{headers:{...regulatedSupplyHeaders,'Content-Type':result.mimeType,'Content-Disposition':`attachment; filename="underlag-${artifactId}.${extension}"`,'Content-Length':String(result.bytes.byteLength),ETag:`"${result.sourceHash}"`}})
})}
