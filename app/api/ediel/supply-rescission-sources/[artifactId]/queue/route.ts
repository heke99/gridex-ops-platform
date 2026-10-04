import {NextRequest,NextResponse} from 'next/server'
import {readSupplyRescissionArtifact} from '@/lib/ediel/production/supplyRescissionIntake'
import {prepareAndQueueSupplyRescissionZ08} from '@/lib/ediel/flows/prodatSupplyRescission'
import {supplyRescissionHttp,supplyRescissionHeaders,supplyRescissionArtifactId,readSupplyRescissionJson} from '@/lib/ediel/production/supplyRescissionHttp'
import {z} from 'zod'
export const runtime='nodejs';export const dynamic='force-dynamic'
/** The client selects an own artifact; its current native read supplies the mandate. */
export async function POST(request:NextRequest,{params}:{params:Promise<{artifactId:string}>}){return supplyRescissionHttp(['communication.write','contracts.read','metering.write'],async guard=>{
 const artifactId=supplyRescissionArtifactId.parse((await params).artifactId);z.object({}).strict().parse(await readSupplyRescissionJson(request,1024))
 const scope={companyId:guard.companyId!,actorUserId:guard.userId},artifact=await readSupplyRescissionArtifact({...scope,artifactId})
 if(artifact.status!=='authorized'||typeof artifact.mandateId!=='string')return NextResponse.json({status:'held',missing:artifact.missing},{status:409,headers:supplyRescissionHeaders})
 const result=await prepareAndQueueSupplyRescissionZ08({...scope,mandateId:artifact.mandateId})
 return NextResponse.json(result,{status:result.status==='held'?409:200,headers:supplyRescissionHeaders})
})}
