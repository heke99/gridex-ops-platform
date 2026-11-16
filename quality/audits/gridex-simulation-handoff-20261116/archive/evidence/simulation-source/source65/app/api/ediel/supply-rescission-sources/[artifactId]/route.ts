import {NextRequest,NextResponse} from 'next/server'
import {readSupplyRescissionArtifact} from '@/lib/ediel/production/supplyRescissionIntake'
import {supplyRescissionHttp,supplyRescissionHeaders,supplyRescissionArtifactId} from '@/lib/ediel/production/supplyRescissionHttp'
export const runtime='nodejs';export const dynamic='force-dynamic'
export async function GET(_request:NextRequest,{params}:{params:Promise<{artifactId:string}>}){return supplyRescissionHttp(['communication.read','contracts.read','metering.read'],async guard=>{const artifactId=supplyRescissionArtifactId.parse((await params).artifactId),result=await readSupplyRescissionArtifact({companyId:guard.companyId!,actorUserId:guard.userId,artifactId});return NextResponse.json(result,{headers:supplyRescissionHeaders})})}
