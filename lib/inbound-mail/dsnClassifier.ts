import { inspectMimeStructure } from './mimeStructure'

// Classify before inspecting returned contents. Classification is not
// authentication. Uninspectable structures also stay out of business ingestion.
export function isDeliveryStatusNotification(raw: string | null | undefined): boolean {
  if (!raw) return false
  const inspected = inspectMimeStructure(raw)
  return inspected.deliveryStatus || inspected.exceededLimits
}
