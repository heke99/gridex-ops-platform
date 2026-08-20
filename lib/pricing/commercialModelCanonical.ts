export * from "./commercialModel";

import {
  commercialModelFromSnapshot as strictCommercialModelFromSnapshot,
  type CanonicalCommercialModel,
} from "./commercialModel";
import { normalizePublishedCommercialSnapshot } from "./canonicalContractEngine";

export function commercialModelFromSnapshot(
  snapshot: Record<string, unknown> | null | undefined,
): CanonicalCommercialModel | null {
  return strictCommercialModelFromSnapshot(
    normalizePublishedCommercialSnapshot(snapshot),
  );
}
