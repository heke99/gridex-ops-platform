# Retry native qualification and authentic type generation

Published fabd150dfb13858258c74a8746e22f075078f6f4, OPS35885232292,
native107263560040: ALL124 PASS, three files,36.37s.
25 source-owner +62 consumption +37 original-wire tests. Retained source-object
SQL71, committed-retry SQL8 and actual concurrency checks also pass.

Passing positives now include actual metering/billing writers and identical
retry, E30 hourly/half-hour/calendar intervals, five changed billing context
completion-gap cases and legitimate-workflow unchanged replay. Real actor
fixture fixed prior FK failure without bypassing events or constraints.
Scoped fixround2 and fixture-only code reviews passed; whole task/whole E035
and final same-head CI remain separately gated.

Actual typegen completed at2026-09-23T15:59:45Z using pinned CLI2.101.0 and
existing nullability override. New type SHA256:
fcd9fa39904fabbf33e62bb1ca5866dbb8792947b4e1324d1f690e009a51f7a2.
Expected old manifest hash then stopped the job before schema generation.
Artifact10762203061 downloaded; ZIP SHA256 verified:
dd746e7a9b2712cdf385adb8aac34fb1a1de5ca8244ea161978cadcbb5e145ac.
Generated types copied verbatim and hash verified, manifest updated with actual
provenance. Next replay must reach tenant/parity/schema gates; no fabricated
schema or claim that overall native job already succeeded.
