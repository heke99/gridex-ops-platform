export * from "./websiteQuotes";

import { persistWebsiteQuote as strictPersistWebsiteQuote } from "./websiteQuotes";
import { normalizeWebsiteQuotePersistenceInput } from "./canonicalContractEngine";

export function persistWebsiteQuote(
  input: Parameters<typeof strictPersistWebsiteQuote>[0],
): ReturnType<typeof strictPersistWebsiteQuote> {
  return strictPersistWebsiteQuote(normalizeWebsiteQuotePersistenceInput(input));
}
