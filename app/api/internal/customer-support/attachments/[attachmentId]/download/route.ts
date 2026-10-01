import {handleProtectedSupportAttachmentDownload}from'@/lib/customer-cases/attachmentScanHttp'
export const runtime='nodejs'
export const dynamic='force-dynamic'
type RouteContext={params:Promise<{attachmentId:string}>}
export async function POST(request:Request,route:RouteContext){return handleProtectedSupportAttachmentDownload(request,(await route.params).attachmentId)}
export async function GET(request:Request,route:RouteContext){return handleProtectedSupportAttachmentDownload(request,(await route.params).attachmentId)}
