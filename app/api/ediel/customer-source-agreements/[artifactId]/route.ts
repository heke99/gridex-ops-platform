import {NextRequest,NextResponse} from 'next/server'
import {readBilateralCustomerSourceArtifact} from '@/lib/ediel/production/bilateralCustomerSource'
import {bilateralSourceHttp,bilateralSourceHeaders,artifactSelector} from '@/lib/ediel/production/bilateralCustomerSourceHttp'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export async function GET(_request:NextRequest,{params}:{params:Promise<{artifactId:string}>}){return bilateralSourceHttp(['communication.read','customers.read','contracts.read'],async guard=>{const artifactId=artifactSelector.parse((await params).artifactId),result=await readBilateralCustomerSourceArtifact({companyId:guard.companyId!,actorUserId:guard.userId,artifactId});return NextResponse.json(result,{headers:bilateralSourceHeaders})})}
