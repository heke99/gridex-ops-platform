import {NextRequest,NextResponse} from 'next/server'
import {readBilateralProdatGroundBytes} from '@/lib/ediel/production/bilateralProdatProfileIntake'
import {bilateralProdatHttp,bilateralProdatHeaders,bilateralProdatArtifactId} from '@/lib/ediel/production/bilateralProdatProfileHttp'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export async function GET(_request:NextRequest,{params}:{params:Promise<{artifactId:string}>}){return bilateralProdatHttp(['communication.read','contracts.read','metering.read'],async guard=>{
 const artifactId=bilateralProdatArtifactId.parse((await params).artifactId),result=await readBilateralProdatGroundBytes({companyId:guard.companyId!,actorUserId:guard.userId,artifactId})
 const extension=result.mimeType==='application/pdf'?'pdf':result.mimeType==='application/json'?'json':'txt'
 return new NextResponse(new Uint8Array(result.bytes),{headers:{...bilateralProdatHeaders,'Content-Type':result.mimeType,'Content-Disposition':`attachment; filename="underlag-${artifactId}.${extension}"`,'Content-Length':String(result.bytes.byteLength),ETag:`"${result.sourceHash}"`}})
})}
