# Registry country source fixture composition

The actual current parser rejects a contradictory positive country claim: market SE and postal DK remain exact retained source values, with `countryCode = null` and conflict diagnostics. The assigned fixture now supplies consistent SE for the positive role/transport-node test and independently exercises contradictory and sole postal-country metadata. Postal data never creates a transport route. No production or native guard changed.

Executed on the observed v4 composition: 11 passed / 1 failed before the fixture repair; 14 / 14 after it. Assigned-file ESLint and diff check passed. Native/browser/exact-head CI are pending. Detailed hashes, names and actual machine receipts are adjacent. This is no whole-criterion or masterplan acceptance.
