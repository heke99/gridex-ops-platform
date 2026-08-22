from pathlib import Path
import re


def read(path: str) -> str:
    return Path(path).read_text(encoding="utf-8")


def write(path: str, text: str) -> None:
    Path(path).write_text(text, encoding="utf-8")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, got {count}")
    return text.replace(old, new, 1)


# Transport/application acknowledgement must never become business acceptance.
for path in ["app/admin/cis/actions.ts", "app/admin/operations/control-actions.ts"]:
    text = read(path)
    pattern = re.compile(
        r"(if \(outboundRequest\.status === 'acknowledged'\) \{\s*"
        r"if \(\['draft', 'queued', 'submitted'\]\.includes\(switchRequest\.status\)\) \{\s*"
        r"return updateSupplierSwitchRequestStatus\(supabase, \{\s*"
        r"requestId: switchRequest\.id,\s*)"
        r"status: 'accepted',",
        re.S,
    )
    text, count = pattern.subn(r"\1status: 'submitted',", text, count=1)
    if count != 1:
        raise SystemExit(f"{path}: acknowledged->accepted legacy transition not found exactly once")
    write(path, text)

# Remove automation path that completed supply from an acknowledged outbound request.
path = "app/admin/operations/control-actions.ts"
text = read(path)
text, count = re.subn(
    r"\nasync function finalizeAcceptedSwitchFromAcknowledgedOutbound\(params: \{.*?\n\}\n\nasync function autoProcessOutboundRequest",
    "\nasync function autoProcessOutboundRequest",
    text,
    count=1,
    flags=re.S,
)
if count != 1:
    raise SystemExit("control-actions: finalizeAcceptedSwitchFromAcknowledgedOutbound block not found")

text = text.replace(
    "import type {\n  CustomerSiteRow,\n  MeteringPointRow,\n} from '@/lib/masterdata/types'",
    "import type { CustomerSiteRow } from '@/lib/masterdata/types'",
)
text = text.replace("  let executedSwitches = 0\n", "")
text, count = re.subn(
    r"\n  const refreshedSwitchRequests = await listAllSupplierSwitchRequests\(supabase, \{.*?\n  \}\n\n  await insertAuditLog\(\{",
    "\n\n  await insertAuditLog({",
    text,
    count=1,
    flags=re.S,
)
if count != 1:
    raise SystemExit("control-actions: acknowledged outbound completion sweep block not found")
text = text.replace("      executedSwitches,\n", "")
write(path, text)

# Persist only canonical switch states. Z04 A/D special supply may be activated,
# but the intermediate state is accepted, never the legacy confirmed alias.
path = "lib/ediel/flows/inboundBusinessStateMachine.ts"
text = read(path)
text = replace_once(
    text,
    "      status: 'confirmed',\n      external_reference: input.message.external_reference ?? undefined,",
    "      status: 'accepted',\n      external_reference: input.message.external_reference ?? undefined,",
    "regulated-supply confirmed alias",
)
write(path, text)

# Remove stale PRODAT meaning/process names and fail closed in the low-level renderer.
path = "lib/ediel/prodat.ts"
text = read(path)
import_anchor = "import { renderProdat26A } from '@/lib/ediel/prodatEngine'\n"
if "isProdatCodeSendable" not in text:
    text = replace_once(
        text,
        import_anchor,
        import_anchor + "import { isProdatCodeSendable } from '@/lib/ediel/prodat/prodatMessageSupportRegistry'\n",
        "prodat sendability import",
    )

text, count = re.subn(
    r"function prodatCodeLabel\(code: ProdatSwitchCode\): string \{.*?\n\}\n\nfunction deriveProcessLabel",
    """function prodatCodeLabel(code: ProdatSwitchCode): string {
  if (code === 'Z03') return 'Leverantörsbyte / leveransstart'
  if (code === 'Z04') return 'Nätägarens bekräftelse på leveransförändring'
  if (code === 'Z05') return 'Information till tidigare leverantör om leveransförändring'
  if (code === 'Z06') return 'Nätägarens kund-/anläggningsuppdatering'
  if (code === 'Z09') return 'Leverantörens kund-/anläggningsuppdatering'
  if (code === 'Z10') return 'Mätaruppgifter från nätägaren'
  if (code === 'Z13') return 'Begäran om mätvärdesåtkomst'
  if (code === 'Z14') return 'Nätägarens svar på mätvärdesåtkomst'
  if (code === 'Z15') return 'Nätägarens ändring av mätvärdesrapportering'
  return 'Begäran om att avsluta mätvärdesrapportering'
}

function deriveProcessLabel""",
    text,
    count=1,
    flags=re.S,
)
if count != 1:
    raise SystemExit("prodatCodeLabel block not found")

text, count = re.subn(
    r"function deriveProcessLabel\(code: ProdatSwitchCode\): string \{.*?\n\}\n\nfunction isResponseCode",
    """function deriveProcessLabel(code: ProdatSwitchCode): string {
  if (code === 'Z03') return 'supplier_switch_request'
  if (code === 'Z04') return 'supplier_switch_confirmation'
  if (code === 'Z05') return 'supply_change_information'
  if (code === 'Z06') return 'grid_owner_masterdata_update'
  if (code === 'Z09') return 'supplier_masterdata_update'
  if (code === 'Z10') return 'meter_masterdata_update'
  if (code === 'Z13') return 'metering_access_request'
  if (code === 'Z14') return 'metering_access_decision'
  if (code === 'Z15') return 'metering_access_state_change'
  return 'metering_access_end_request'
}

function isResponseCode""",
    text,
    count=1,
    flags=re.S,
)
if count != 1:
    raise SystemExit("deriveProcessLabel block not found")

text, count = re.subn(
    r"function isResponseCode\(code: ProdatSwitchCode\): boolean \{.*?\n\}",
    """function isResponseCode(code: ProdatSwitchCode): boolean {
  return code === 'Z04' || code === 'Z14'
}""",
    text,
    count=1,
    flags=re.S,
)
if count != 1:
    raise SystemExit("isResponseCode block not found")

text, count = re.subn(
    r"function preferredReferencePrefix\(code: ProdatSwitchCode\): string \{.*?\n\}\n\nfunction statusSegmentForCode",
    """function preferredReferencePrefix(code: ProdatSwitchCode): string {
  if (code === 'Z03') return 'SWITCH'
  if (code === 'Z04') return 'SWITCH-CONF'
  if (code === 'Z05') return 'SUPPLY-INFO'
  if (code === 'Z06') return 'GRID-MASTERDATA'
  if (code === 'Z09') return 'SUPPLIER-MASTERDATA'
  if (code === 'Z10') return 'METER-MASTERDATA'
  if (code === 'Z13') return 'METERING-ACCESS'
  if (code === 'Z14') return 'METERING-ACCESS-DECISION'
  if (code === 'Z15') return 'METERING-ACCESS-STATE'
  return 'METERING-ACCESS-END-REQ'
}

function statusSegmentForCode""",
    text,
    count=1,
    flags=re.S,
)
if count != 1:
    raise SystemExit("preferredReferencePrefix block not found")

guard_anchor = "  return (async () => {\n    const validation = validateProdatSwitchContext({"
guard_replacement = """  return (async () => {
    if (!isProdatCodeSendable(code)) {
      throw new Error(`prodat_outbound_direction_not_allowed:${code}`)
    }

    const validation = validateProdatSwitchContext({"""
text = replace_once(text, guard_anchor, guard_replacement, "low-level PRODAT outbound guard")
write(path, text)

# Add source-level regression assertions so these legacy paths cannot return silently.
path = "__tests__/prodat-26a-semantic-hardening.test.ts"
text = read(path)
insertion = r'''

  it('removes legacy source paths that treated transport ACK as business acceptance', () => {
    const cisActions = fs.readFileSync(path.join(process.cwd(), 'app/admin/cis/actions.ts'), 'utf8')
    const controlActions = fs.readFileSync(path.join(process.cwd(), 'app/admin/operations/control-actions.ts'), 'utf8')
    const inboundState = fs.readFileSync(path.join(process.cwd(), 'lib/ediel/flows/inboundBusinessStateMachine.ts'), 'utf8')
    const prodatSource = fs.readFileSync(path.join(process.cwd(), 'lib/ediel/prodat.ts'), 'utf8')

    expect(cisActions).not.toMatch(/outboundRequest\.status === 'acknowledged'[\s\S]{0,500}status: 'accepted'/)
    expect(controlActions).not.toMatch(/outboundRequest\.status === 'acknowledged'[\s\S]{0,500}status: 'accepted'/)
    expect(controlActions).not.toContain('finalizeAcceptedSwitchFromAcknowledgedOutbound')
    expect(inboundState).not.toContain("status: 'confirmed'")
    expect(prodatSource).not.toContain("if (code === 'Z05') return 'Inflytt/övertagande'")
    expect(prodatSource).not.toContain("if (code === 'Z06') return 'Svar på inflytt/övertagande'")
    expect(prodatSource).not.toContain("if (code === 'Z05') return 'move_in_request'")
    expect(prodatSource).toContain('prodat_outbound_direction_not_allowed')
  })
'''
if "removes legacy source paths that treated transport ACK as business acceptance" not in text:
    idx = text.rfind("\n})")
    if idx < 0:
        raise SystemExit("test describe closing marker not found")
    text = text[:idx] + insertion + text[idx:]
    write(path, text)
