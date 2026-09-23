# Diagnostic refinement review — 67bd0b2d

**SPEC: APPROVED. QUALITY: APPROVED for diagnostic refinement only.** Reviewed the supplied `cfe206de..67bd0b2d` diff; no production-owner acceptance is implied.

The instrumentation now recognizes the chunk containing the private helper's exception handler and substitutes bare `RAISE;` for that handler's `RETURN false;`. Within that handler this rethrows the original exception, preserving SQLSTATE/message/context instead of disguising the failure as guard17. Ordinary false-return sites retain their labels. These changes remain inside the existing rolled-back diagnostic transaction; published functions/migrations are not changed persistently.

The captured context is shortened to 3500 characters with separately extracted PL/pgSQL stack-frame lines. This keeps useful call/line information while reducing repeated synthetic composition output. RPC observation and all prior owner acceptance/rejection assertions are unchanged.

The new minimal expression probe is isolated in a temporary function and transaction. It separately asserts the hypothesized unparenthesized-expression `22P02` and parenthesized empty-key result; it neither changes the production expression nor grants a source approval. If the hypothesis is wrong, the new assertion fails visibly. Its result must be observed in native replay before treating it as root-cause evidence.

The reported replay remains 57 passed / 4 failed. Wire/party/current-row truth and a guard17 trace narrow the investigation but do not establish a positive owner. No broad tests or production edits were performed for this review; only this report was written. Actual diagnostic execution, any forward production fix, and final owner qualification remain separate gates.
