/** Operator queue order within one status and priority (J1-14, owner decision 39): a task with a deadline comes
 * before one without, the earliest deadline first. Unreadable deadlines count as none. */
export function compareTaskDueAt(a: string | null | undefined, b: string | null | undefined): number {
  const left = Date.parse(a ?? ''), right = Date.parse(b ?? '')
  const hasLeft = Number.isFinite(left), hasRight = Number.isFinite(right)
  if (hasLeft && hasRight) return left - right
  if (hasLeft) return -1
  if (hasRight) return 1
  return 0
}
