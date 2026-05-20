import type { EdielRuleGroup, EdielRuleListRow } from '@/components/admin/ediel/EdielRuleGroups'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { EdielMessageRuleRow } from '@/lib/ediel/types'
import {
  resolveInboundAcceptedVersionsRuntime,
  resolveOutboundMessageVersionRuntime,
} from '@/lib/ediel/config'

export type PlatformEdielRuntimeSnapshot = {
  key: string
  family: string
  code: string
  standard: 'edifact' | 'xml' | 'ai_list'
  outbound: Awaited<ReturnType<typeof resolveOutboundMessageVersionRuntime>>
  inbound: Awaited<ReturnType<typeof resolveInboundAcceptedVersionsRuntime>>
  activeCount: number
}

export type PlatformEdielRuleOverview = {
  messageRules: EdielMessageRuleRow[]
  ruleGroups: EdielRuleGroup[]
  runtimeSnapshots: PlatformEdielRuntimeSnapshot[]
  activeRuleCount: number
  negativeSupportCount: number
  ambiguousRuntimeCount: number
  previousValidCount: number
  hasProdatRule: boolean
}

function sortRuleRows(rows: EdielMessageRuleRow[]) {
  return [...rows].sort((a, b) => {
    const aFrom = a.valid_from ?? ''
    const bFrom = b.valid_from ?? ''
    if (aFrom !== bFrom) return bFrom.localeCompare(aFrom)
    return String(b.version_code).localeCompare(String(a.version_code))
  })
}

function pickCurrentRule(rows: EdielRuleListRow[], runtimeCurrentVersion: string | null): EdielRuleListRow | null {
  if (runtimeCurrentVersion) {
    const exact = rows.find((row) => row.version_code === runtimeCurrentVersion)
    if (exact) return exact
  }

  return rows.find((row) => row.is_active) ?? rows[0] ?? null
}

function pickPreviousRule(
  rows: EdielRuleListRow[],
  currentRule: EdielRuleListRow | null,
  runtimePreviousVersion: string | null
): EdielRuleListRow | null {
  if (runtimePreviousVersion) {
    const exact = rows.find(
      (row) => row.version_code === runtimePreviousVersion && row.id !== currentRule?.id
    )
    if (exact) return exact
  }

  return rows.find((row) => row.id !== currentRule?.id && row.is_active) ?? rows.find((row) => row.id !== currentRule?.id) ?? null
}

export async function loadPlatformEdielRuleOverview(): Promise<PlatformEdielRuleOverview> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('ediel_message_rules')
    .select('*')
    .order('message_family', { ascending: true })
    .order('message_code', { ascending: true })
    .order('valid_from', { ascending: false, nullsFirst: false })

  if (error) throw error

  const messageRules = (data ?? []) as EdielMessageRuleRow[]
  const groupMap = new Map<string, EdielMessageRuleRow[]>()

  for (const row of messageRules) {
    const key = `${row.message_family}__${row.message_code}__${row.message_standard}`
    if (!groupMap.has(key)) groupMap.set(key, [])
    groupMap.get(key)!.push(row)
  }

  const groupedRules = [...groupMap.entries()].map(([key, rows]) => ({
    key,
    rows: sortRuleRows(rows),
  }))

  const runtimeSnapshots = await Promise.all(
    groupedRules.map(async (group) => {
      const first = group.rows[0]
      const outbound = await resolveOutboundMessageVersionRuntime({
        family: first.message_family,
        code: first.message_code,
        standard: first.message_standard,
      })
      const inbound = await resolveInboundAcceptedVersionsRuntime({
        family: first.message_family,
        code: first.message_code,
        standard: first.message_standard,
      })

      return {
        key: group.key,
        family: first.message_family,
        code: first.message_code,
        standard: first.message_standard,
        outbound,
        inbound,
        activeCount: group.rows.filter((row) => row.is_active).length,
      }
    })
  )

  const runtimeSnapshotByKey = new Map(runtimeSnapshots.map((row) => [row.key, row]))

  const ruleGroups: EdielRuleGroup[] = groupedRules.map((group) => {
    const first = group.rows[0]
    const snapshot = runtimeSnapshotByKey.get(group.key)
    const rows: EdielRuleListRow[] = group.rows.map((row) => ({
      ...row,
      statusTag: 'history',
      runtimeCurrentVersion: snapshot?.outbound.currentVersion ?? null,
      runtimePreviousVersion: snapshot?.inbound.previousVersion ?? null,
      acceptedVersions: snapshot?.inbound.acceptedVersions ?? [],
    }))
    const currentRule = pickCurrentRule(rows, snapshot?.outbound.currentVersion ?? null)
    const previousRule = pickPreviousRule(rows, currentRule, snapshot?.inbound.previousVersion ?? null)
    const taggedRows = rows.map((row) => ({
      ...row,
      statusTag:
        row.id === currentRule?.id
          ? ('current' as const)
          : row.id === previousRule?.id
            ? ('previous' as const)
            : ('history' as const),
    }))

    return {
      key: group.key,
      family: first.message_family,
      code: first.message_code,
      standard: first.message_standard,
      rows: taggedRows,
      currentRule: taggedRows.find((row) => row.id === currentRule?.id) ?? null,
      previousRule: taggedRows.find((row) => row.id === previousRule?.id) ?? null,
      historyRules: taggedRows.filter((row) => row.id !== currentRule?.id && row.id !== previousRule?.id),
    }
  })

  return {
    messageRules,
    ruleGroups,
    runtimeSnapshots,
    activeRuleCount: messageRules.filter((row) => row.is_active).length,
    negativeSupportCount: messageRules.filter((row) => row.supports_negative_response).length,
    ambiguousRuntimeCount: runtimeSnapshots.filter((row) => row.activeCount > 1).length,
    previousValidCount: runtimeSnapshots.filter((row) => row.inbound.previousVersion).length,
    hasProdatRule: messageRules.some((row) => row.message_family === 'PRODAT'),
  }
}
