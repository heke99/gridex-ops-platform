from pathlib import Path


def replace_once(path: str, old: str, new: str):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f'missing replacement anchor in {path}: {old[:120]!r}')
    if text.count(old) != 1:
        raise SystemExit(f'non-unique replacement anchor in {path}: {text.count(old)}')
    p.write_text(text.replace(old, new, 1))


# Return the DB-mutated job state/result. BEFORE INSERT Z02 gates may change
# queued -> needs_review and/or attach atomic apply evidence.
replace_once(
    'lib/customer-operations/automation.part-1.ts',
    ".insert(row)\n    .select('id')\n    .single()",
    ".insert(row)\n    .select('id, operation_id, trace_id, status, result, last_error')\n    .single()",
)
replace_once(
    'lib/customer-operations/automation.part-1.ts',
    "return { id: String(data.id), duplicate: false, operationId, traceId, status: 'queued', result: null, lastError: null }",
    "return {\n      id: String(data.id),\n      duplicate: false,\n      operationId: normalizeUuidOrNull(data.operation_id, 'operation_id') ?? operationId,\n      traceId: normalizeUuidOrNull(data.trace_id, 'trace_id') ?? traceId,\n      status: (clean(data.status) as CustomerOperationJobStatus | null) ?? 'queued',\n      result: record(data.result),\n      lastError: clean(data.last_error),\n    }",
)

# Inbound receipt is transport evidence only. Do not mutate/link customer
# masterdata until correlation + payload + snapshot + atomic DB gates pass.
inbound_path = Path('lib/onboarding/inboundEdielLinking.ts')
inbound = inbound_path.read_text()
start = inbound.index('export async function applyInboundProdatZ02ToCustomerInfoRequest')
end = inbound.index('export async function applyInboundProdatZ14ToMeteringPermission', start)
z02_fn = r'''export async function applyInboundProdatZ02ToCustomerInfoRequest(params: {
  actorUserId: string
  message: EdielMessageRow
}): Promise<ApplyResult> {
  if (params.message.message_family !== 'PRODAT' || String(params.message.message_code).toUpperCase() !== 'Z02') {
    return { applied: false, targetId: null, reason: 'not_z02' }
  }

  const request = await findCustomerInfoRequestForZ02(params.message)
  if (!request) {
    await createEdielMessageEvent({
      actorUserId: params.actorUserId,
      edielMessageId: params.message.id,
      eventType: 'manual_note',
      eventStatus: 'warning',
      message: 'PRODAT Z02 kunde inte kopplas automatiskt till en uppgiftsbegäran.',
      payload: { references: messageReferenceCandidates(params.message) },
    })
    return { applied: false, targetId: null, reason: 'no_matching_customer_info_request' }
  }

  const companyId = params.message.company_id
  if (!companyId) return { applied: false, targetId: null, reason: 'missing_company_id' }

  const persistenceActorId =
    uuidOrNull(params.actorUserId) ??
    uuidOrNull(request.created_by) ??
    uuidOrNull(params.message.created_by)
  const eventActorId = persistenceActorId ?? params.actorUserId
  const z02Payload = prodatPayloadSnapshot(params.message)
  const linkedCustomerId = String(request.customer_id ?? '') || String(params.message.customer_id ?? '')
  const linkedSiteId = String(request.site_id ?? '') || String(params.message.site_id ?? '')

  // Receipt is message-level evidence only. Do not mark the candidate request
  // verified or pre-link customer/site before the canonical DB gates run.
  await createEdielMessageEvent({
    actorUserId: eventActorId,
    edielMessageId: params.message.id,
    eventType: 'manual_note',
    eventStatus: 'info',
    message: 'PRODAT Z02 mottaget. Canonical korrelation och identitetskontroll startas innan kunddata får ändras.',
    payload: { candidateCustomerInfoRequestId: request.id, z02: z02Payload },
  })

  if (!linkedCustomerId || !linkedSiteId) {
    await supabaseService
      .from('customer_info_requests')
      .update({
        status: 'manual_review_required',
        blocker_code: 'z02_missing_customer_or_site_link',
        blocker_reason: 'Svaret saknar säker koppling till kundens anläggning.',
        next_required_action: 'Granska Z02 och koppla rätt kund/anläggning innan svaret behandlas.',
        updated_by: persistenceActorId,
        updated_at: new Date().toISOString(),
      })
      .eq('company_id', companyId)
      .eq('id', request.id)
    await tenantDb(companyId).from('customer_info_request_events').insert({
      customer_info_request_id: request.id,
      customer_id: request.customer_id,
      event_type: 'z02_needs_review',
      message: 'Svar från nätägaren kunde inte kopplas säkert till en anläggning.',
      payload: { z02: z02Payload },
      created_by: persistenceActorId,
    })
    return { applied: false, targetId: String(request.id), reason: 'missing_customer_or_site_link' }
  }

  const operationId = uuidOrNull(request.operation_id)
  let responseJob: Awaited<ReturnType<typeof enqueueInboundGridOwnerResponseAutomation>>
  try {
    responseJob = await enqueueInboundGridOwnerResponseAutomation({
      companyId,
      customerId: linkedCustomerId,
      siteId: linkedSiteId,
      meteringPointId: String(request.metering_point_id ?? '') || String(params.message.metering_point_id ?? '') || null,
      requestId: String(request.id),
      edielMessageId: params.message.id,
      actorUserId: persistenceActorId,
      operationId,
    })
  } catch (enqueueError) {
    const errorMessage = enqueueError instanceof Error ? enqueueError.message : String(enqueueError)
    await supabaseService
      .from('customer_info_requests')
      .update({
        status: 'manual_review_required',
        blocker_code: 'z02_processing_enqueue_failed',
        blocker_reason: errorMessage,
        next_required_action: 'Granska requestsnapshot och Z02 innan kunddata uppdateras.',
        updated_by: persistenceActorId,
        updated_at: new Date().toISOString(),
      })
      .eq('company_id', companyId)
      .eq('id', request.id)
    await createEdielMessageEvent({
      actorUserId: eventActorId,
      edielMessageId: params.message.id,
      eventType: 'manual_note',
      eventStatus: 'error',
      message: 'Z02 kunde inte starta canonical verifiering och applicerades inte.',
      payload: { customerInfoRequestId: request.id, error: errorMessage },
    })
    return { applied: false, targetId: String(request.id), reason: 'z02_processing_enqueue_failed' }
  }

  const gateResult = readJson(responseJob.result)
  const atomicCore = readJson(gateResult.z02_atomic_core)
  const atomicApplied =
    gateResult.z02_correlation_status === 'exact' &&
    gateResult.z02_payload_validation_status === 'valid' &&
    gateResult.z02_snapshot_freshness_status === 'valid' &&
    gateResult.z02_atomic_core_applied === true &&
    atomicCore.ok === true

  if (responseJob.status === 'needs_review' || responseJob.status === 'blocked' || !atomicApplied) {
    const reasonCode = stringOrNull(gateResult.reason_code) ?? stringOrNull(gateResult.reason) ?? 'z02_atomic_apply_not_confirmed'
    const blockerReason = stringOrNull(gateResult.blocker_reason) ?? 'Z02 klarade inte hela canonical verifieringskedjan och applicerades inte.'

    if (responseJob.status !== 'needs_review' && responseJob.status !== 'blocked') {
      await supabaseService
        .from('customer_info_requests')
        .update({
          status: 'manual_review_required',
          blocker_code: reasonCode,
          blocker_reason: blockerReason,
          next_required_action: 'Granska Z02-gaterna innan automation återupptas.',
          updated_by: persistenceActorId,
          updated_at: new Date().toISOString(),
        })
        .eq('company_id', companyId)
        .eq('id', request.id)
      await supabaseService
        .from('customer_operation_jobs')
        .update({ status: 'needs_review', last_error: blockerReason, updated_at: new Date().toISOString() })
        .eq('company_id', companyId)
        .eq('id', responseJob.id)
    }

    await tenantDb(companyId).from('customer_info_request_events').insert({
      customer_info_request_id: request.id,
      customer_id: request.customer_id,
      event_type: 'z02_needs_review',
      message: blockerReason,
      payload: { customerOperationJobId: responseJob.id, operationId: responseJob.operationId, reasonCode, gateResult },
      created_by: persistenceActorId,
    })
    await createEdielMessageEvent({
      actorUserId: eventActorId,
      edielMessageId: params.message.id,
      eventType: 'manual_note',
      eventStatus: 'warning',
      message: blockerReason,
      payload: { customerInfoRequestId: request.id, customerOperationJobId: responseJob.id, reasonCode, gateResult },
    })
    return { applied: false, targetId: String(request.id), reason: reasonCode }
  }

  await tenantDb(companyId).from('customer_info_request_events').insert({
    customer_info_request_id: request.id,
    customer_id: request.customer_id,
    event_type: 'z02_market_verified',
    message: 'PRODAT Z02 passerade canonical korrelation, identitetskontroll, requestsnapshot och atomisk masterdataapply.',
    payload: { customerOperationJobId: responseJob.id, operationId: responseJob.operationId, atomicCore },
    created_by: persistenceActorId,
  })
  await createEdielMessageEvent({
    actorUserId: eventActorId,
    edielMessageId: params.message.id,
    eventType: 'linked',
    eventStatus: 'success',
    message: 'PRODAT Z02 verifierades och applicerades atomiskt mot exakt uppgiftsbegäran.',
    payload: { customerInfoRequestId: request.id, customerOperationJobId: responseJob.id },
  })

  return { applied: true, targetId: String(request.id) }
}

'''
inbound_path.write_text(inbound[:start] + z02_fn + inbound[end:])

# Worker convergence: DB atomic core owns site/meter/request/GODR mutation.
p2 = Path('lib/customer-operations/automation.part-2.ts')
text = p2.read_text()
text = text.replace(
    "import { parseProdatMessage } from '@/lib/ediel/prodat/parser'\nimport type { EdielMessageRow } from '@/lib/ediel/types'",
    "import { parseProdatMessage } from '@/lib/ediel/prodat/parser'\nimport { getEdielMessageById } from '@/lib/ediel/db'\nimport type { EdielMessageRow } from '@/lib/ediel/types'",
    1,
)
text = text.replace(
    "import { getMeteringPointIdentity } from '@/lib/customers/meteringIdentity'",
    "import { getMeteringPointIdentity } from '@/lib/customers/meteringIdentity'\nimport { listMeteringPointsForSite } from '@/lib/operations/db'",
    1,
)
old_process = '''export async function processInboundResponse(job: JobRow): Promise<JobOutcome> {
  const payload = record(job.payload)
  const requestId = clean(payload.customer_info_request_id)
  const messageId = clean(payload.ediel_message_id)
  if (!job.customer_site_id || !requestId || !messageId) return { status: 'failed', result: { reason: 'missing_inbound_job_context' } }
  const result = await applyInboundGridOwnerResponse({
    companyId: job.company_id,
    customerId: job.customer_id,
    siteId: job.customer_site_id,
    requestId,
    edielMessageId: messageId,
    actorUserId: job.created_by,
    operationId: job.operation_id ?? job.id,
    customerOperationJobId: job.id,
  })
  return { status: 'completed', result }
}
'''
new_process = '''export function canonicalAtomicZ02JobResult(result: JsonRecord | null): JsonRecord | null {
  const root = record(result)
  const core = record(root.z02_atomic_core)
  if (
    root.z02_correlation_status !== 'exact' ||
    root.z02_payload_validation_status !== 'valid' ||
    root.z02_snapshot_freshness_status !== 'valid' ||
    root.z02_atomic_core_applied !== true ||
    core.ok !== true
  ) return null
  return core
}

export async function processInboundResponse(job: JobRow): Promise<JobOutcome> {
  const payload = record(job.payload)
  const requestId = normalizeUuidOrNull(payload.customer_info_request_id, 'customer_info_request_id')
  const messageId = normalizeUuidOrNull(payload.ediel_message_id, 'ediel_message_id')
  const siteId = normalizeUuidOrNull(job.customer_site_id, 'customer_site_id')
  if (!siteId || !requestId || !messageId) return { status: 'failed', result: { reason: 'missing_inbound_job_context' } }

  const atomicCore = canonicalAtomicZ02JobResult(job.result)
  if (!atomicCore) {
    return {
      status: 'needs_review',
      result: blockerResult('stale_response_requires_review', {
        blocker_reason: 'Z02 saknar komplett canonical bevis för korrelation, payload, requestsnapshot eller atomisk apply. Ingen app-layer masterdataändring körs.',
        next_required_action: 'Granska Z02-gaterna och originating Z01 innan automation återupptas.',
      }, { operation_id: job.operation_id, ediel_message_id: messageId, customer_info_request_id: requestId }),
    }
  }

  const meteringPointId = normalizeUuidOrNull(atomicCore.meteringPointRecordId, 'metering_point_record_id')
  const externalMeteringPointId = clean(atomicCore.meteringPointExternalId)
  if (!meteringPointId || !externalMeteringPointId) {
    return { status: 'needs_review', result: { reason: 'z02_atomic_metering_point_evidence_missing', atomic_core: atomicCore } }
  }

  const [message, meteringPoints] = await Promise.all([
    getEdielMessageById(messageId, { companyId: job.company_id }),
    listMeteringPointsForSite(supabaseService, siteId),
  ])
  if (!message || message.company_id !== job.company_id || message.customer_id !== job.customer_id || message.site_id !== siteId) {
    return { status: 'needs_review', result: { reason: 'z02_atomic_message_link_mismatch', atomic_core: atomicCore } }
  }
  const point = meteringPoints.find((candidate) => candidate.id === meteringPointId) ?? null
  const pointRecord = record(point as unknown as JsonRecord)
  if (
    !point ||
    clean(point.status) !== 'active' ||
    clean(pointRecord.verification_status) !== 'verified' ||
    clean(pointRecord.data_quality_status) !== 'verified' ||
    getMeteringPointIdentity(point) !== externalMeteringPointId
  ) {
    return { status: 'needs_review', result: { reason: 'z02_atomic_metering_point_not_verified', atomic_core: atomicCore } }
  }

  const actorUserId = automationActorId(job.created_by)
  await completeLinkedGridOwnerInformationRequest({
    companyId: job.company_id,
    outboundEdielMessageId: clean(message.related_message_id),
    inboundEdielMessageId: messageId,
    facilityId: clean(atomicCore.facilityId),
    meteringPointExternalId: externalMeteringPointId,
    gridAreaCode: clean(atomicCore.gridAreaCode),
    priceArea: clean(atomicCore.priceAreaCode),
    verified: true,
    receivedPayload: { atomic_core: atomicCore },
    actorUserId,
  })

  const switchJob = await enqueueSupplierSwitchAutomation({
    companyId: job.company_id,
    customerId: job.customer_id,
    siteId,
    meteringPointId,
    actorUserId,
    operationId: job.operation_id ?? job.id,
    source: 'z02_market_verified',
  })

  await emitCustomerOperationEvent({
    companyId: job.company_id,
    customerId: job.customer_id,
    actorUserId,
    eventType: 'customer_data.received',
    title: 'Nätägarens Z02 verifierad',
    message: 'Z02 har applicerats atomiskt. Systemet använder verifierad anläggning/mätpunkt och kör nu canonical readiness för nästa leverantörsbytessteg.',
    customerSiteId: siteId,
    meteringPointId,
    customerOperationJobId: job.id,
    operationId: job.operation_id ?? job.id,
    actionUrl: `/admin/customers/${job.customer_id}?tab=data-requests`,
    payload: { atomic_core: atomicCore, supplier_switch_job_id: switchJob.id, supplier_switch_job_status: switchJob.status },
    idempotencyKey: `z02-atomic-finalized:${messageId}`,
  })

  return {
    status: 'completed',
    result: {
      reason: 'z02_atomic_core_finalized',
      customer_info_request_id: requestId,
      ediel_message_id: messageId,
      metering_point_id: meteringPointId,
      atomic_core: atomicCore,
      supplier_switch_job_id: switchJob.id,
      supplier_switch_job_status: switchJob.status,
    },
  }
}
'''
if old_process not in text:
    raise SystemExit('processInboundResponse anchor missing')
text = text.replace(old_process, new_process, 1)
p2.write_text(text)

# Forward DB migration. Generate the replacement core from the applied source
# and change only market-context authority, plus a new stale-snapshot gate.
old_sql = Path('supabase/migrations/20260821145500_atomic_correlated_z02_core_apply.sql').read_text()
core_start = old_sql.index('create or replace function public.gridex_apply_exact_z02_core(')
core_end = old_sql.index('create or replace function public.gridex_gate_exact_z02_atomic_apply()', core_start)
core = old_sql[core_start:core_end]
core = core.replace(
    '  v_annual numeric;\n  v_now timestamptz := now();',
    '  v_annual numeric;\n  v_inbound_price_area text;\n  v_price_area_count integer := 0;\n  v_now timestamptz := now();',
    1,
)
old_price = '''  v_price_area := upper(coalesce(
    nullif(btrim(v_message.parsed_payload ->> 'priceAreaCode'), ''),
    nullif(btrim(v_message.parsed_payload ->> 'price_area_code'), ''),
    nullif(btrim(v_site.price_area_code), '')
  ));
'''
new_price = '''  v_inbound_price_area := upper(coalesce(
    nullif(btrim(v_message.parsed_payload ->> 'priceAreaCode'), ''),
    nullif(btrim(v_message.parsed_payload ->> 'price_area_code'), '')
  ));

  select count(distinct upper(pga.price_area))::integer,
         min(upper(pga.price_area))
    into v_price_area_count, v_price_area
  from public.platform_grid_areas pga
  where pga.is_active = true
    and upper(pga.grid_area_code) = upper(v_grid_area)
    and upper(coalesce(pga.price_area, '')) in ('SE1','SE2','SE3','SE4')
    and (pga.valid_from is null or pga.valid_from <= current_date)
    and (pga.valid_to is null or pga.valid_to >= current_date);
'''
if old_price not in core:
    raise SystemExit('atomic core price-area anchor missing')
core = core.replace(old_price, new_price, 1)
old_checks = '''  if v_meter_external is null then
    return jsonb_build_object('ok', false, 'code', 'z02_metering_point_missing');
  end if;
  if v_price_area is not null and v_price_area not in ('SE1','SE2','SE3','SE4') then
    return jsonb_build_object('ok', false, 'code', 'invalid_price_area');
  end if;
'''
new_checks = '''  if v_meter_external is null then
    return jsonb_build_object('ok', false, 'code', 'z02_metering_point_missing');
  end if;
  if v_price_area_count <> 1 or v_price_area not in ('SE1','SE2','SE3','SE4') then
    return jsonb_build_object('ok', false, 'code', 'z02_grid_area_price_area_unresolved', 'gridAreaCode', v_grid_area);
  end if;
  if v_inbound_price_area is not null and v_inbound_price_area not in ('SE1','SE2','SE3','SE4') then
    return jsonb_build_object('ok', false, 'code', 'invalid_price_area');
  end if;
  if v_inbound_price_area is not null and v_inbound_price_area <> v_price_area then
    return jsonb_build_object('ok', false, 'code', 'z02_price_area_conflict', 'inboundPriceArea', v_inbound_price_area, 'canonicalPriceArea', v_price_area);
  end if;
  if nullif(btrim(v_site.price_area_code), '') is not null and upper(v_site.price_area_code) <> v_price_area then
    return jsonb_build_object('ok', false, 'code', 'z02_existing_price_area_conflict', 'existingPriceArea', upper(v_site.price_area_code), 'canonicalPriceArea', v_price_area);
  end if;
  if v_annual is not null and v_annual < 0 then
    return jsonb_build_object('ok', false, 'code', 'z02_annual_consumption_invalid');
  end if;
'''
if old_checks not in core:
    raise SystemExit('atomic core validation anchor missing')
core = core.replace(old_checks, new_checks, 1)

gate_start = old_sql.index('create or replace function public.gridex_gate_exact_z02_atomic_apply()', core_end)
gate_end = old_sql.index('drop trigger if exists trg_customer_operation_job_z02_zz_atomic_apply', gate_start)
atomic_gate = old_sql[gate_start:gate_end]
old_atomic_condition = "     or coalesce(new.result ->> 'z02_correlation_status', '') <> 'exact'\n     or coalesce((new.result ->> 'z02_atomic_core_applied')::boolean, false) then"
new_atomic_condition = "     or coalesce(new.result ->> 'z02_correlation_status', '') <> 'exact'\n     or coalesce(new.result ->> 'z02_payload_validation_status', '') <> 'valid'\n     or coalesce(new.result ->> 'z02_snapshot_freshness_status', '') <> 'valid'\n     or coalesce((new.result ->> 'z02_atomic_core_applied')::boolean, false) then"
if old_atomic_condition not in atomic_gate:
    raise SystemExit('atomic gate condition anchor missing')
atomic_gate = atomic_gate.replace(old_atomic_condition, new_atomic_condition, 1)

snapshot_guard = r'''create or replace function public.gridex_gate_inbound_z02_snapshot_freshness()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_request_id uuid;
  v_site public.customer_sites%rowtype;
  v_snapshot jsonb;
  v_expected_site_id text;
  v_expected_address_hash text;
  v_expected_grid_owner_id text;
  v_expected_facility_id text;
  v_current_address_hash text;
  v_reason_code text := null;
  v_reason_text text := null;
  v_details jsonb := '{}'::jsonb;
begin
  if new.job_type <> 'apply_inbound_grid_owner_response'
     or new.status not in ('queued', 'running')
     or coalesce(new.result ->> 'z02_correlation_status', '') <> 'exact'
     or coalesce(new.result ->> 'z02_payload_validation_status', '') <> 'valid'
     or coalesce((new.result ->> 'z02_atomic_core_applied')::boolean, false) then
    return new;
  end if;

  v_snapshot := case
    when jsonb_typeof(new.request_snapshot) = 'object' and new.request_snapshot <> '{}'::jsonb then new.request_snapshot
    when jsonb_typeof(new.payload -> 'site_snapshot') = 'object' then new.payload -> 'site_snapshot'
    else '{}'::jsonb
  end;
  v_expected_site_id := nullif(btrim(v_snapshot ->> 'site_id'), '');
  v_expected_address_hash := nullif(btrim(v_snapshot ->> 'address_hash'), '');
  v_expected_grid_owner_id := nullif(btrim(v_snapshot ->> 'grid_owner_id'), '');
  v_expected_facility_id := nullif(btrim(v_snapshot ->> 'facility_id'), '');

  begin
    v_request_id := nullif(new.payload ->> 'customer_info_request_id', '')::uuid;
  exception when others then
    v_reason_code := 'z02_snapshot_identifiers_invalid';
    v_reason_text := 'Z02 requestsnapshot saknar giltig request-identitet.';
  end;

  if v_reason_code is null then
    select * into v_site from public.customer_sites
    where id = new.customer_site_id and company_id = new.company_id and customer_id = new.customer_id;
    if not found then
      v_reason_code := 'z02_snapshot_site_missing';
      v_reason_text := 'Anläggningen från requestsnapshot finns inte längre i rätt tenant/kund.';
    end if;
  end if;

  if v_reason_code is null then
    v_current_address_hash := coalesce(
      nullif(btrim(v_site.address_hash), ''),
      lower(concat_ws('|',
        nullif(btrim(v_site.street), ''),
        nullif(regexp_replace(coalesce(v_site.postal_code, ''), '[^0-9]', '', 'g'), ''),
        nullif(btrim(v_site.city), '')
      ))
    );
    if v_expected_site_id is null or v_expected_address_hash is null then
      v_reason_code := 'z02_operation_snapshot_missing';
      v_reason_text := 'Originating Z01 saknar komplett requestsnapshot och Z02 får inte appliceras automatiskt.';
    elsif v_expected_site_id <> new.customer_site_id::text then
      v_reason_code := 'z02_snapshot_site_mismatch';
      v_reason_text := 'Requestsnapshot avser en annan anläggning.';
    elsif v_current_address_hash is distinct from v_expected_address_hash then
      v_reason_code := 'site_address_changed_after_request';
      v_reason_text := 'Anläggningsadressen ändrades efter originating Z01. Z02 kräver manuell granskning.';
    elsif v_expected_grid_owner_id is not null and v_site.grid_owner_id::text is distinct from v_expected_grid_owner_id then
      v_reason_code := 'site_grid_owner_changed_after_request';
      v_reason_text := 'Nätägaren ändrades efter originating Z01. Z02 kräver manuell granskning.';
    elsif v_expected_facility_id is not null and regexp_replace(upper(coalesce(v_site.facility_id, '')), '[^0-9A-Z]', '', 'g') <> regexp_replace(upper(v_expected_facility_id), '[^0-9A-Z]', '', 'g') then
      v_reason_code := 'site_facility_changed_after_request';
      v_reason_text := 'Anläggnings-ID ändrades efter originating Z01. Z02 kräver manuell granskning.';
    end if;
  end if;

  v_details := jsonb_build_object(
    'gate', 'gridex_gate_inbound_z02_snapshot_freshness',
    'customer_info_request_id', v_request_id,
    'expected_site_id', v_expected_site_id,
    'expected_address_hash', v_expected_address_hash,
    'current_address_hash', v_current_address_hash,
    'expected_grid_owner_id', v_expected_grid_owner_id,
    'current_grid_owner_id', v_site.grid_owner_id,
    'expected_facility_id', v_expected_facility_id,
    'current_facility_id', v_site.facility_id,
    'evaluated_at', now()
  );

  if v_reason_code is not null then
    new.status := 'needs_review';
    new.result := coalesce(new.result, '{}'::jsonb) || jsonb_build_object(
      'reason', v_reason_code,
      'reason_code', v_reason_code,
      'blocker_reason', v_reason_text,
      'z02_snapshot_freshness', v_details
    );
    if v_request_id is not null then
      update public.customer_info_requests
      set status = 'manual_review_required', blocker_code = v_reason_code,
          blocker_reason = v_reason_text,
          blocker_details = coalesce(blocker_details, '{}'::jsonb) || jsonb_build_object('z02_snapshot_freshness', v_details),
          next_required_action = 'Granska ändrad anläggning mot originating Z01 innan Z02 appliceras.', updated_at = now()
      where id = v_request_id and company_id = new.company_id;
    end if;
    return new;
  end if;

  new.result := coalesce(new.result, '{}'::jsonb) || jsonb_build_object(
    'z02_snapshot_freshness_status', 'valid', 'z02_snapshot_freshness', v_details
  );
  return new;
end;
$$;

drop trigger if exists trg_customer_operation_job_z02_snapshot_freshness on public.customer_operation_jobs;
create trigger trg_customer_operation_job_z02_snapshot_freshness
before insert or update of status, payload, request_snapshot, result
on public.customer_operation_jobs
for each row execute function public.gridex_gate_inbound_z02_snapshot_freshness();

'''
Path('supabase/migrations/20260903213000_z02_snapshot_market_context_guard.sql').write_text(
    '-- Canonical inbound Z02 convergence: stale-request protection and internal market-context authority.\n\n'
    + snapshot_guard + core + '\n' + atomic_gate
)

Path('__tests__/ediel-inbound-route-business-response.test.ts').write_text(r'''import { describe, expect, it } from 'vitest'
import { inboundRouteMessageCodeMatches } from '@/lib/ediel/tenant/resolveInboundTenant'

describe('inbound route business-response matching', () => {
  it('allows canonical Z02 as the business response to a configured PRODAT Z01 route', () => {
    expect(inboundRouteMessageCodeMatches({ family: 'PRODAT', configuredCode: 'Z01', inboundCode: 'Z02' })).toBe(true)
  })
  it('keeps exact message-code routes valid', () => {
    expect(inboundRouteMessageCodeMatches({ family: 'PRODAT', configuredCode: 'Z02', inboundCode: 'Z02' })).toBe(true)
  })
  it('does not turn unrelated PRODAT codes into route evidence', () => {
    expect(inboundRouteMessageCodeMatches({ family: 'PRODAT', configuredCode: 'Z03', inboundCode: 'Z02' })).toBe(false)
  })
  it('fails closed for unknown families on a mismatched code', () => {
    expect(inboundRouteMessageCodeMatches({ family: 'UNKNOWN', configuredCode: 'A', inboundCode: 'B' })).toBe(false)
  })
})
''')

Path('__tests__/z02-atomic-worker-convergence.test.ts').write_text(r'''import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { canonicalAtomicZ02JobResult } from '@/lib/customer-operations/automation.part-2'

describe('canonical Z02 atomic worker convergence', () => {
  it('accepts only the complete DB gate chain', () => {
    expect(canonicalAtomicZ02JobResult({
      z02_correlation_status: 'exact', z02_payload_validation_status: 'valid',
      z02_snapshot_freshness_status: 'valid', z02_atomic_core_applied: true,
      z02_atomic_core: { ok: true, meteringPointRecordId: '11111111-1111-4111-8111-111111111111' },
    })?.ok).toBe(true)
    expect(canonicalAtomicZ02JobResult({
      z02_correlation_status: 'exact', z02_payload_validation_status: 'valid',
      z02_atomic_core_applied: true, z02_atomic_core: { ok: true },
    })).toBeNull()
  })
  it('does not run the legacy second app-layer core apply from the worker', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'lib/customer-operations/automation.part-2.ts'), 'utf8')
    const start = source.indexOf('export async function processInboundResponse')
    const end = source.indexOf('export type DispatchBlockerEntry', start)
    const worker = source.slice(start, end)
    expect(worker).not.toContain('applyInboundGridOwnerResponse(')
    expect(worker).toContain('canonicalAtomicZ02JobResult(job.result)')
    expect(worker).toContain("clean(point.status) !== 'active'")
  })
  it('derives price area from canonical platform registry and guards stale snapshots', () => {
    const migration = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/20260903213000_z02_snapshot_market_context_guard.sql'), 'utf8')
    expect(migration).toContain('from public.platform_grid_areas pga')
    expect(migration).toContain("'z02_price_area_conflict'")
    expect(migration).toContain("'z02_grid_area_price_area_unresolved'")
    expect(migration).toContain('v_annual < 0')
    expect(migration).toContain("z02_snapshot_freshness_status', 'valid'")
  })
})
''')

Path('__tests__/z02-raw-receipt-before-verification.test.ts').write_text(r'''import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Z02 receipt is not verification', () => {
  it('does not write verified payload or link customer/site before canonical gates', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'lib/onboarding/inboundEdielLinking.ts'), 'utf8')
    const start = source.indexOf('export async function applyInboundProdatZ02ToCustomerInfoRequest')
    const enqueue = source.indexOf('enqueueInboundGridOwnerResponseAutomation({', start)
    const preGate = source.slice(start, enqueue)
    expect(preGate).not.toContain('verified_payload:')
    expect(preGate).not.toContain('linkEdielMessage({')
    expect(preGate).not.toContain("status: 'z02_received'")
  })
  it('fails closed when DB does not return atomic proof', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'lib/onboarding/inboundEdielLinking.ts'), 'utf8')
    expect(source).toContain('z02_atomic_apply_not_confirmed')
    expect(source).toContain('z02_processing_enqueue_failed')
    expect(source).toContain("gateResult.z02_snapshot_freshness_status === 'valid'")
  })
})
''')
