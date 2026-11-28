import { NextResponse, type NextRequest } from 'next/server'
import { requireAdminApiAccess, requireAdminOperationalCompany } from '@/lib/admin/apiGuards'
import { ApiInputError, readJsonObject } from '@/lib/api/strictRequest'
import { internalApiError } from '@/lib/http/apiError'
import { supabaseService } from '@/lib/supabase/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ id: string }> }
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
const fields = new Set(['original_underlay_id', 'corrected_underlay_id', 'source_value_id', 'reason'])
const headers = { 'Cache-Control': 'no-store' }

function requiredId(value: unknown, field: string) {
  if (typeof value !== 'string' || !uuid.test(value)) {
    throw new ApiInputError('Ett giltigt ID krävs.', 'invalid_correction_id', 400, field)
  }
  return value.toLowerCase()
}

export async function POST(request: NextRequest, { params }: Props) {
  try {
    const access = await requireAdminApiAccess(['billing_underlay.export'])
    if (access.response) return access.response
    const invoiceId = requiredId((await params).id, 'id')
    const body = await readJsonObject(request, 8_192)
    if (Object.keys(body).some(field => !fields.has(field))) {
      throw new ApiInputError('Rättelsebegäran innehåller ett okänt fält.', 'invalid_correction_field', 400)
    }
    const original = requiredId(body.original_underlay_id, 'original_underlay_id')
    const corrected = requiredId(body.corrected_underlay_id, 'corrected_underlay_id')
    const source = requiredId(body.source_value_id, 'source_value_id')
    const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
    if (!reason || Array.from(reason).length > 1_000 || original === corrected) {
      throw new ApiInputError('Ange en motivering och ett separat rättat underlag.', 'invalid_correction_request', 400)
    }
    const companyId = await requireAdminOperationalCompany(access.guard)
    const args = {
      p_company_id: companyId,
      p_invoice_id: invoiceId,
      p_actor_user_id: access.guard.userId,
      p_original_underlay_id: original,
      p_corrected_underlay_id: corrected,
      p_source_value_id: source,
      p_reason: reason,
    }
    const { data, error } = await supabaseService.rpc('gridex_register_invoice_correction_v1', args)
    if (error) {
      if (error.code === 'P0002' && ['invoice_group_correction_original_not_found', 'invoice_correction_original_not_found'].includes(error.message)) {
        return NextResponse.json({
          error: error.message === 'invoice_group_correction_original_not_found'
            ? 'Den utfärdade samlingsfakturan hittades inte.'
            : 'Den utfärdade fakturan hittades inte.',
        }, { status: 404, headers })
      }
      if ((error.code === '23514' && ['invoice_group_correction_source_unqualified', 'invoice_correction_source_unqualified',
        'invoice_correction_origin_unqualified', 'invoice_file_frozen_artifact_invalid'].includes(error.message))
        || (error.code === '23505' && ['invoice_group_correction_conflict', 'invoice_correction_conflict'].includes(error.message))) {
        return NextResponse.json({ error: 'Rättelsens underlag eller befintliga ärende behöver kontrolleras.' }, { status: 409, headers })
      }
      if (error.code === '42501' && ['invoice_group_correction_permission_denied', 'invoice_correction_permission_denied'].includes(error.message)) {
        return NextResponse.json({ error: 'Saknar behörighet för bolaget.' }, { status: 403, headers })
      }
      if (error.message === 'finance_copy_retention_tombstoned' && error.code === '23514') {
        return NextResponse.json({ error: 'Originalunderlaget får inte längre användas.' }, { status: 410, headers })
      }
      throw error
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)
      || typeof data.caseId !== 'string' || !uuid.test(data.caseId)
      || data.originalInvoiceId !== invoiceId || typeof data.replayed !== 'boolean') {
      throw new Error('Kunde inte verifiera det sparade rättelseärendet.')
    }
    return NextResponse.json({
      case_id: data.caseId,
      original_invoice_id: invoiceId,
      replayed: data.replayed,
      approval_required: true,
    }, { status: data.replayed ? 200 : 201, headers })
  } catch (error) {
    if (error instanceof ApiInputError) {
      return NextResponse.json({ error: error.message, code: error.code, ...(error.field ? { field: error.field } : {}) },
        { status: error.status, headers })
    }
    return internalApiError({
      context: 'invoice_correction_registration',
      error,
      code: 'invoice_correction_registration_failed',
      message: 'Rättelseärendet kunde inte registreras.',
    })
  }
}
