from pathlib import Path
import re

BRANCH = "fix/prodat-26a-semantic-hardening-20260822"


def read(path: str) -> str:
    return Path(path).read_text(encoding="utf-8")


def write(path: str, text: str) -> None:
    Path(path).write_text(text, encoding="utf-8")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, got {count}")
    return text.replace(old, new, 1)


# Canonical activation readiness helper: Z04 business confirmation + effective market date.
activation_path = Path("lib/operations/supplierSwitchActivation.ts")
activation_path.write_text("""import type { SupplierSwitchRequestRow } from '@/lib/operations/types'\n\nexport type SupplierSwitchActivationReadiness = {\n  ready: boolean\n  code:\n    | 'ready'\n    | 'not_accepted'\n    | 'missing_z04_confirmation'\n    | 'missing_effective_start_date'\n    | 'awaiting_effective_start_date'\n  effectiveStartDate: string | null\n  marketDate: string\n  reason: string\n}\n\nfunction dateOnly(value: string | null | undefined): string | null {\n  if (!value) return null\n  const trimmed = value.trim()\n  if (!trimmed) return null\n  const match = /^(\\d{4}-\\d{2}-\\d{2})/.exec(trimmed)\n  return match?.[1] ?? null\n}\n\nexport function stockholmMarketDate(now = new Date()): string {\n  const parts = new Intl.DateTimeFormat('en-CA', {\n    timeZone: 'Europe/Stockholm',\n    year: 'numeric',\n    month: '2-digit',\n    day: '2-digit',\n  }).formatToParts(now)\n\n  const year = parts.find((part) => part.type === 'year')?.value\n  const month = parts.find((part) => part.type === 'month')?.value\n  const day = parts.find((part) => part.type === 'day')?.value\n  if (!year || !month || !day) throw new Error('stockholm_market_date_resolution_failed')\n  return `${year}-${month}-${day}`\n}\n\nexport function supplierSwitchEffectiveStartDate(\n  request: Pick<SupplierSwitchRequestRow, 'confirmed_start_date' | 'requested_start_date'>\n): string | null {\n  return dateOnly(request.confirmed_start_date) ?? dateOnly(request.requested_start_date)\n}\n\nexport function getSupplierSwitchActivationReadiness(\n  request: Pick<\n    SupplierSwitchRequestRow,\n    'status' | 'inbound_z04_message_id' | 'confirmed_start_date' | 'requested_start_date'\n  >,\n  now = new Date()\n): SupplierSwitchActivationReadiness {\n  const marketDate = stockholmMarketDate(now)\n  const effectiveStartDate = supplierSwitchEffectiveStartDate(request)\n\n  if (request.status !== 'accepted') {\n    return {\n      ready: false,\n      code: 'not_accepted',\n      effectiveStartDate,\n      marketDate,\n      reason: 'Leverantörsbytet måste vara affärsmässigt bekräftat av nätägaren med inbound PRODAT Z04.',\n    }\n  }\n\n  if (!request.inbound_z04_message_id) {\n    return {\n      ready: false,\n      code: 'missing_z04_confirmation',\n      effectiveStartDate,\n      marketDate,\n      reason: 'Accepted-status saknar korrelerad inbound PRODAT Z04 och får inte aktivera leveransen.',\n    }\n  }\n\n  if (!effectiveStartDate) {\n    return {\n      ready: false,\n      code: 'missing_effective_start_date',\n      effectiveStartDate: null,\n      marketDate,\n      reason: 'Nätägaren har bekräftat bytet men ett verifierat startdatum saknas.',\n    }\n  }\n\n  if (effectiveStartDate > marketDate) {\n    return {\n      ready: false,\n      code: 'awaiting_effective_start_date',\n      effectiveStartDate,\n      marketDate,\n      reason: `Nätägaren har bekräftat bytet. Leveransen aktiveras tidigast ${effectiveStartDate}.`,\n    }\n  }\n\n  return {\n    ready: true,\n    code: 'ready',\n    effectiveStartDate,\n    marketDate,\n    reason: `Inbound PRODAT Z04 är korrelerad och startdatum ${effectiveStartDate} är uppnått.`,\n  }\n}\n""", encoding="utf-8")

# Types: expose canonical Z04 correlation and confirmed start date everywhere.
path = "lib/operations/types.ts"
text = read(path)
anchor = "  external_reference: string | null;\n  submitted_at: string | null;"
replacement = "  external_reference: string | null;\n  inbound_z04_message_id?: string | null;\n  confirmed_start_date?: string | null;\n  submitted_at: string | null;"
text = replace_once(text, anchor, replacement, "supplier switch Z04 fields")
write(path, text)

# Control tower: transport acknowledgement != business confirmation; accepted waits for effective date.
path = "lib/operations/controlTower.ts"
text = read(path)
import_anchor = "import type {\n  SwitchReadinessResult,\n  SupplierSwitchRequestRow,\n} from '@/lib/operations/types'\n"
if "getSupplierSwitchActivationReadiness" not in text:
    text = replace_once(
        text,
        import_anchor,
        import_anchor + "import { getSupplierSwitchActivationReadiness } from '@/lib/operations/supplierSwitchActivation'\n",
        "control tower activation import",
    )
text = text.replace("  | 'awaiting_response'\n  | 'ready_to_execute'", "  | 'awaiting_response'\n  | 'awaiting_market_confirmation'\n  | 'awaiting_effective_date'\n  | 'ready_to_execute'")

start = text.index("export function getSwitchLifecycle(")
end = text.index("\nexport function explainWhySwitchIsStuck", start)
new_get = """export function getSwitchLifecycle(params: {\n  request: SupplierSwitchRequestRow\n  readiness?: SwitchReadinessResult | null\n  outboundRequest?: OutboundRequestRow | null\n}): {\n  stage: SwitchLifecycleStage\n  label: string\n  reason: string\n} {\n  const { request, readiness, outboundRequest } = params\n\n  if (['failed', 'rejected'].includes(request.status)) {\n    return {\n      stage: 'failed',\n      label: 'Misslyckad',\n      reason: request.failure_reason ?? 'Switchärendet har stoppats eller avvisats.',\n    }\n  }\n\n  if (request.status === 'completed') {\n    return { stage: 'completed', label: 'Klar', reason: 'Leveransen är aktiverad för det bekräftade startdatumet.' }\n  }\n\n  if (request.status === 'accepted') {\n    const activation = getSupplierSwitchActivationReadiness(request)\n    if (activation.ready) {\n      return { stage: 'ready_to_execute', label: 'Redo för leveransstart', reason: activation.reason }\n    }\n    if (activation.code === 'awaiting_effective_start_date') {\n      return { stage: 'awaiting_effective_date', label: 'Väntar på startdatum', reason: activation.reason }\n    }\n    return { stage: 'blocked', label: 'Kontroll krävs', reason: activation.reason }\n  }\n\n  if (readiness && !readiness.isReady) {\n    return { stage: 'blocked', label: 'Blockerad', reason: summarizeReadinessIssues(readiness) }\n  }\n\n  if (!outboundRequest) {\n    return { stage: 'queued_for_outbound', label: 'Redo att köa Z03', reason: 'Ärendet är redo men saknar outbound PRODAT Z03.' }\n  }\n\n  if (['queued', 'prepared'].includes(outboundRequest.status)) {\n    return { stage: 'awaiting_dispatch', label: 'Väntar på dispatch', reason: 'PRODAT Z03 finns men har inte skickats ännu.' }\n  }\n\n  if (outboundRequest.status === 'sent') {\n    return { stage: 'awaiting_response', label: 'Väntar på kvittens', reason: 'PRODAT Z03 är skickad och väntar på transport-/applikationskvittens.' }\n  }\n\n  if (outboundRequest.status === 'acknowledged') {\n    return {\n      stage: 'awaiting_market_confirmation',\n      label: 'Kvitterad – väntar på Z04',\n      reason: 'Transport/applikation är kvitterad. Leverantörsbytet är inte affärsmässigt bekräftat förrän inbound PRODAT Z04 mottas.',\n    }\n  }\n\n  if (outboundRequest.status === 'failed' || outboundRequest.status === 'cancelled') {\n    return {\n      stage: 'failed',\n      label: 'Dispatch-fel',\n      reason: outboundRequest.failure_reason ?? 'Outbound-requesten stoppades.',\n    }\n  }\n\n  return { stage: 'queued_for_outbound', label: 'Oklassificerad', reason: 'Kunde inte fastställa livscykel tydligt.' }\n}\n"""
text = text[:start] + new_get + text[end:]

start = text.index("export function explainWhySwitchIsStuck(")
end = text.index("\nexport function summarizeDispatchAttempt", start)
new_explain = """export function explainWhySwitchIsStuck(params: {\n  request: SupplierSwitchRequestRow\n  readiness?: SwitchReadinessResult | null\n  outboundRequest?: OutboundRequestRow | null\n}): string {\n  const { request, readiness, outboundRequest } = params\n\n  if (['failed', 'rejected'].includes(request.status)) {\n    return request.failure_reason ?? 'Switchärendet har felstatus.'\n  }\n\n  if (request.status === 'accepted') {\n    return getSupplierSwitchActivationReadiness(request).reason\n  }\n\n  if (readiness && !readiness.isReady) {\n    return `Readiness blockerar: ${summarizeReadinessIssues(readiness)}`\n  }\n\n  if (!outboundRequest) return 'Switchen saknar outbound PRODAT Z03 och har därför inte dispatchats.'\n  if (outboundRequest.channel_type === 'unresolved') return 'Outbound saknar route/kanal och kan inte dispatchas.'\n  if (['queued', 'prepared'].includes(outboundRequest.status)) return 'PRODAT Z03 väntar fortfarande på dispatch.'\n  if (outboundRequest.status === 'sent') return 'PRODAT Z03 är skickad och väntar på transport-/applikationskvittens.'\n  if (outboundRequest.status === 'failed' || outboundRequest.status === 'cancelled') {\n    return outboundRequest.failure_reason ?? 'Outbound-dispatchen misslyckades och behöver retry eller manuell åtgärd.'\n  }\n  if (outboundRequest.status === 'acknowledged') {\n    return 'Transport/applikation är kvitterad. Inbound PRODAT Z04 från nätägaren krävs fortfarande innan bytet är affärsmässigt bekräftat.'\n  }\n  return 'Ingen tydlig blockerare kunde fastställas.'\n}\n"""
text = text[:start] + new_explain + text[end:]
write(path, text)

# Central execution function: no activation before Z04 + effective date.
path = "lib/operations/db.part-2.ts"
text = read(path)
import_anchor = "import { calculateEarliestSwitchStartDate } from \"@/lib/operations/switchStartDate\"\n"
if "getSupplierSwitchActivationReadiness" not in text:
    text = replace_once(
        text,
        import_anchor,
        import_anchor + "import { getSupplierSwitchActivationReadiness } from \"@/lib/operations/supplierSwitchActivation\"\n",
        "db activation import",
    )
anchor = """  if (requestBefore.status !== \"accepted\") {\n    throw new Error(\n      \"Switchärendet måste vara accepted innan det kan slutföras\",\n    );\n  }\n\n  const siteUpdatePayload = {"""
replacement = """  if (requestBefore.status !== \"accepted\") {\n    throw new Error(\n      \"Switchärendet måste vara accepted efter inbound PRODAT Z04 innan det kan slutföras\",\n    );\n  }\n\n  const activationReadiness = getSupplierSwitchActivationReadiness(requestBefore);\n  if (!activationReadiness.ready) {\n    throw new Error(`supplier_switch_activation_blocked:${activationReadiness.code}:${activationReadiness.reason}`);\n  }\n\n  const siteUpdatePayload = {"""
text = replace_once(text, anchor, replacement, "central activation guard")
text = text.replace('"Switchen slutfördes automatiskt efter kvitterad outbound."', '"Leveransen aktiverades automatiskt efter inbound PRODAT Z04 och uppnått startdatum."')
write(path, text)

# Automation sweep must never create another Z03 after Z04 acceptance.
path = "app/admin/operations/control-actions.ts"
text = read(path)
text = replace_once(
    text,
    "    if (!['queued', 'submitted', 'accepted'].includes(request.status)) {",
    "    if (!['queued', 'submitted'].includes(request.status)) {",
    "automation accepted resend blocker",
)
write(path, text)

# Admin actions: accepted/completed are business-owned states; bulk readiness is Z04+date, not ACK.
path = "app/admin/operations/actions.ts"
text = read(path)
text = text.replace("  listOutboundRequests,\n", "")
text = text.replace("import type { OutboundRequestRow } from '@/lib/cis/types'\n", "")
if "getSupplierSwitchActivationReadiness" not in text:
    text = text.replace(
        "import type {\n  CustomerOperationTaskStatus,",
        "import { getSupplierSwitchActivationReadiness } from '@/lib/operations/supplierSwitchActivation'\nimport type {\n  CustomerOperationTaskStatus,",
        1,
    )
text, count = re.subn(
    r"\nfunction findAcknowledgedOutboundForSwitch\(params: \{.*?\n\}\n\nfunction revalidateSupplierSwitchPaths",
    "\nfunction revalidateSupplierSwitchPaths",
    text,
    count=1,
    flags=re.S,
)
if count != 1:
    raise SystemExit("findAcknowledgedOutboundForSwitch block not found")

anchor = """  if (!requestId) {\n    throw new Error('Switch request ID saknas')\n  }\n\n  const saved = await updateSupplierSwitchRequestStatus(supabase, {"""
replacement = """  if (!requestId) {\n    throw new Error('Switch request ID saknas')\n  }\n\n  const current = await getSupplierSwitchRequestById(supabase, requestId)\n  if (!current) throw new Error('Switchärendet hittades inte')\n  if (status === 'accepted' || status === 'completed') {\n    throw new Error('accepted styrs av inbound PRODAT Z04 och completed av leveransstart på bekräftat startdatum.')\n  }\n  if (current.status === 'accepted' || current.status === 'completed') {\n    throw new Error('Ett affärsmässigt bekräftat eller slutfört switchärende får inte backas via generell statusändring.')\n  }\n\n  const saved = await updateSupplierSwitchRequestStatus(supabase, {"""
text = replace_once(text, anchor, replacement, "generic admin business-state guard")

start = text.index("export async function bulkFinalizeReadySupplierSwitchesAction(): Promise<void> {")
end = text.index("\nexport async function retryOutboundFromSwitchDetailAction", start)
new_bulk = """export async function bulkFinalizeReadySupplierSwitchesAction(): Promise<void> {\n  await requireAdminActionAccess([MASTERDATA_PERMISSIONS.WRITE])\n\n  const actor = await getActor()\n  const supabase = await createSupabaseServerClient()\n\n  const requestsQuery = await supabase\n    .from('supplier_switch_requests')\n    .select('*')\n    .eq('status', 'accepted')\n    .order('confirmed_start_date', { ascending: true, nullsFirst: false })\n    .order('requested_start_date', { ascending: true, nullsFirst: false })\n    .order('created_at', { ascending: true })\n\n  if (requestsQuery.error) throw requestsQuery.error\n\n  const switchRequests = (requestsQuery.data ?? []) as SupplierSwitchRequestRow[]\n  const readyRequests = switchRequests.filter(\n    (request) => getSupplierSwitchActivationReadiness(request).ready\n  )\n\n  let completedCount = 0\n\n  for (const request of readyRequests) {\n    const readiness = getSupplierSwitchActivationReadiness(request)\n    const result = await finalizeSupplierSwitchExecution(supabase, {\n      requestId: request.id,\n      actorUserId: actor.id,\n      executionSource: 'bulk_admin_ready_queue',\n      executionNotes: 'Bulk-aktivering efter inbound PRODAT Z04 och uppnått bekräftat startdatum.',\n    })\n\n    await writeSupplierSwitchExecutionAudit({\n      actorUserId: actor.id,\n      result,\n      executionSource: 'bulk_admin_ready_queue',\n    })\n\n    await createSupplierSwitchEvent(supabase, {\n      switchRequestId: result.request.id,\n      eventType: 'bulk_execution_completed',\n      eventStatus: 'completed',\n      message: 'Leveransen aktiverades från ready-to-execute-kön efter Z04 och uppnått startdatum.',\n      payload: {\n        inboundZ04MessageId: request.inbound_z04_message_id ?? null,\n        effectiveStartDate: readiness.effectiveStartDate,\n        marketDate: readiness.marketDate,\n        executionSource: 'bulk_admin_ready_queue',\n      },\n    })\n\n    await syncCustomerOperationsForCustomer(supabase, result.request.customer_id)\n    revalidateSupplierSwitchPaths(result.request.customer_id, result.request.id)\n    completedCount += 1\n  }\n\n  await insertAuditLog({\n    actorUserId: actor.id,\n    entityType: 'supplier_switch_execution_bulk',\n    entityId: actor.id,\n    action: 'supplier_switch_ready_queue_bulk_execution_ran',\n    metadata: {\n      scannedAcceptedCount: switchRequests.length,\n      readyCount: readyRequests.length,\n      completedCount,\n      blockedCount: switchRequests.length - readyRequests.length,\n      readinessRule: 'inbound_z04_plus_effective_start_date',\n    },\n  })\n\n  revalidatePath('/admin/operations')\n  revalidatePath('/admin/operations/switches')\n  revalidatePath('/admin/operations/ready-to-execute')\n}\n"""
text = text[:start] + new_bulk + text[end:]

# Retry may retry transport, but it must never erase a Z04-confirmed business state.
retry_anchor = """  const outboundRequest = await getOutboundRequestById(outboundRequestId)\n\n  if (!outboundRequest) {\n    throw new Error('Outbound request hittades inte')\n  }\n\n  const reset = await resetOutboundRequestForRetry({"""
retry_repl = """  const [outboundRequest, switchRequest] = await Promise.all([\n    getOutboundRequestById(outboundRequestId),\n    getSupplierSwitchRequestById(supabase, switchRequestId),\n  ])\n\n  if (!outboundRequest) throw new Error('Outbound request hittades inte')\n  if (!switchRequest) throw new Error('Switchärendet hittades inte')\n  if (switchRequest.status === 'accepted' || switchRequest.status === 'completed') {\n    throw new Error('Outbound får inte återköas genom att backa ett Z04-bekräftat eller slutfört switchärende.')\n  }\n\n  const reset = await resetOutboundRequestForRetry({"""
text = replace_once(text, retry_anchor, retry_repl, "retry business-state guard")
write(path, text)

# Ready-to-execute UI: show market confirmation/effective-date semantics, keep ACK only as diagnostics.
path = "app/admin/operations/ready-to-execute/page.tsx"
text = read(path)
text = text.replace(
    'subtitle="Dedikerad kö för accepted + acknowledged switchar som väntar på sista interna execution-steget. Här kan du slutföra enskilt eller i bulk."',
    'subtitle="Kö för nätägarbekräftade switchar där inbound PRODAT Z04 finns och bekräftat startdatum har uppnåtts."',
)
text = text.replace('Kräver mer än bara accepted-status, oftast outbound-läge.', 'Väntar normalt på bekräftat startdatum eller kräver granskning av Z04-kopplingen.')
text = text.replace('Kör detta när du vill slutföra hela kön av acknowledged switchar i ett steg.', 'Aktivera alla switchar där Z04 är korrelerad och bekräftat startdatum är uppnått.')
text = text.replace('Endast switchar där lifecycle nu är redo för intern execution.', 'Endast switchar där nätägaren har bekräftat bytet med Z04 och leveransens startdatum är uppnått.')
text = text.replace('Slutför switch nu', 'Aktivera leverans nu')
write(path, text)

# Regression coverage for activation semantics and source guards.
path = "__tests__/prodat-26a-semantic-hardening.test.ts"
text = read(path)
if "getSupplierSwitchActivationReadiness" not in text:
    text = text.replace(
        "import { decideProdatLifecycle, normalizeProdatSubtype } from '@/lib/ediel/stateMachines/prodatLifecycle'\n",
        "import { decideProdatLifecycle, normalizeProdatSubtype } from '@/lib/ediel/stateMachines/prodatLifecycle'\nimport { getSupplierSwitchActivationReadiness } from '@/lib/operations/supplierSwitchActivation'\n",
    )
insert = r'''

  it('requires inbound Z04 and reached effective date before supply activation', () => {
    const base = {
      status: 'accepted' as const,
      inbound_z04_message_id: 'z04-message',
      confirmed_start_date: '2026-08-22',
      requested_start_date: '2026-08-22',
    }
    expect(getSupplierSwitchActivationReadiness(base, new Date('2026-08-22T10:00:00Z')).ready).toBe(true)
    expect(getSupplierSwitchActivationReadiness({ ...base, inbound_z04_message_id: null }, new Date('2026-08-22T10:00:00Z')).code).toBe('missing_z04_confirmation')
    expect(getSupplierSwitchActivationReadiness({ ...base, confirmed_start_date: '2026-08-23' }, new Date('2026-08-22T10:00:00Z')).code).toBe('awaiting_effective_start_date')

    const controlActions = fs.readFileSync(path.join(process.cwd(), 'app/admin/operations/control-actions.ts'), 'utf8')
    const operationsActions = fs.readFileSync(path.join(process.cwd(), 'app/admin/operations/actions.ts'), 'utf8')
    expect(controlActions).not.toContain("['queued', 'submitted', 'accepted']")
    expect(operationsActions).toContain('inbound_z04_plus_effective_start_date')
    expect(operationsActions).not.toContain('findAcknowledgedOutboundForSwitch')
  })
'''
if "requires inbound Z04 and reached effective date before supply activation" not in text:
    idx = text.rfind("\n})")
    if idx < 0:
        raise SystemExit("test describe close not found")
    text = text[:idx] + insert + text[idx:]
write(path, text)

# DB fail-closed invariant: even direct SQL cannot complete before the Stockholm effective date.
migration = Path("supabase/migrations/20260822012000_supplier_switch_effective_date_guard.sql")
migration.write_text("""-- PRODAT 26.A supplier-switch activation invariant.\n-- Business acceptance requires inbound Z04; completion additionally requires\n-- an effective start date that has been reached in the Swedish market timezone.\n\nbegin;\n\ncreate or replace function public.gridex_enforce_supplier_switch_z04_confirmation_v1()\nreturns trigger\nlanguage plpgsql\nset search_path = public\nas $$\ndeclare\n  effective_start_date date;\n  stockholm_market_date date := (now() at time zone 'Europe/Stockholm')::date;\nbegin\n  if new.status = 'confirmed' then\n    if new.inbound_z04_message_id is null then\n      raise exception using\n        errcode = '23514',\n        message = 'supplier_switch_confirmed_requires_inbound_z04',\n        detail = 'Legacy confirmed state may only be normalized when a correlated inbound PRODAT Z04 is linked.';\n    end if;\n    new.status := 'accepted';\n  end if;\n\n  if new.status = 'accepted' and new.inbound_z04_message_id is null then\n    new.status := 'submitted';\n    if new.submitted_at is null then new.submitted_at := now(); end if;\n    new.completed_at := null;\n  end if;\n\n  if new.inbound_z04_message_id is not null and not exists (\n    select 1\n    from public.ediel_messages m\n    where m.id = new.inbound_z04_message_id\n      and m.company_id = new.company_id\n      and m.direction = 'inbound'\n      and upper(m.message_family) = 'PRODAT'\n      and upper(coalesce(m.message_code,'')) = 'Z04'\n  ) then\n    raise exception using\n      errcode = '23514',\n      message = 'supplier_switch_inbound_z04_reference_invalid',\n      detail = 'inbound_z04_message_id must reference an inbound PRODAT Z04 in the same tenant.';\n  end if;\n\n  if new.status = 'completed' then\n    if new.inbound_z04_message_id is null then\n      raise exception using\n        errcode = '23514',\n        message = 'supplier_switch_business_confirmation_requires_inbound_z04',\n        detail = 'A supplier switch cannot be completed before a correlated inbound PRODAT Z04 has confirmed the market change.';\n    end if;\n\n    if tg_op = 'UPDATE' and old.status not in ('accepted','completed') then\n      raise exception using\n        errcode = '23514',\n        message = 'supplier_switch_completion_requires_accepted_state',\n        detail = 'Completion must follow the accepted state established by inbound PRODAT Z04.';\n    end if;\n\n    effective_start_date := coalesce(new.confirmed_start_date, new.requested_start_date)::date;\n    if effective_start_date is null then\n      raise exception using\n        errcode = '23514',\n        message = 'supplier_switch_effective_start_date_required',\n        detail = 'A supplier switch cannot be completed without a confirmed or requested effective start date.';\n    end if;\n\n    if effective_start_date > stockholm_market_date then\n      raise exception using\n        errcode = '23514',\n        message = 'supplier_switch_effective_date_not_reached',\n        detail = format('Effective start date %s has not been reached in Europe/Stockholm (market date %s).', effective_start_date, stockholm_market_date);\n    end if;\n  end if;\n\n  return new;\nend;\n$$;\n\ncomment on function public.gridex_enforce_supplier_switch_z04_confirmation_v1() is\n  'PRODAT 26.A invariant: ACK remains submitted; accepted requires inbound Z04; completed requires prior accepted state and reached effective date in Europe/Stockholm.';\n\ncommit;\n""", encoding="utf-8")

# Test verifies DB guard text as part of migration chain.
path = "__tests__/prodat-26a-semantic-hardening.test.ts"
text = read(path)
needle = "    expect(migration).toContain('Expected 34 active PRODAT 26.A semantic rows')\n"
if "supplier_switch_effective_date_not_reached" not in text:
    replacement = needle + "\n    const activationMigration = fs.readFileSync(\n      path.join(process.cwd(), 'supabase/migrations/20260822012000_supplier_switch_effective_date_guard.sql'),\n      'utf8',\n    )\n    expect(activationMigration).toContain('supplier_switch_effective_date_not_reached')\n    expect(activationMigration).toContain(\"time zone 'Europe/Stockholm'\")\n"
    text = replace_once(text, needle, replacement, "migration regression extension")
write(path, text)
