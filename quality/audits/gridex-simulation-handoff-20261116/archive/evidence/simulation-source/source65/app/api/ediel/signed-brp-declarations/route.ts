import {NextRequest,NextResponse} from 'next/server'
import {archiveSignedBrpDeclaration} from '@/lib/ediel/production/signedBrpDeclarationIntake'
import {signedBrpHttp,signedBrpHeaders,signedBrpSubmission,readSignedBrpJson,signedBrpArchiveBodyLimit,signedBrpWritePermissions} from '@/lib/ediel/production/signedBrpDeclarationHttp'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export async function POST(request:NextRequest){return signedBrpHttp(signedBrpWritePermissions,async guard=>{
 const input=signedBrpSubmission.parse(await readSignedBrpJson(request,signedBrpArchiveBodyLimit))
 return NextResponse.json(await archiveSignedBrpDeclaration(guard.companyId!,input),{status:201,headers:signedBrpHeaders})
})}
