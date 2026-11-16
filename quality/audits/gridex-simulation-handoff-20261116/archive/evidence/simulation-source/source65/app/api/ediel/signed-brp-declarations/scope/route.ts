import {NextRequest,NextResponse} from 'next/server'
import {previewSignedBrpDeclaration} from '@/lib/ediel/production/signedBrpDeclarationIntake'
import {signedBrpHttp,signedBrpHeaders,signedBrpSelector,readSignedBrpJson,signedBrpReadPermissions} from '@/lib/ediel/production/signedBrpDeclarationHttp'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export async function POST(request:NextRequest){return signedBrpHttp(signedBrpReadPermissions,async guard=>{
 const input=signedBrpSelector.parse(await readSignedBrpJson(request,64*1024)),result=await previewSignedBrpDeclaration(guard.companyId!,input)
 return NextResponse.json(result,{status:result.status==='held'?409:200,headers:signedBrpHeaders})
})}
