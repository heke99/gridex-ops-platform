# State machines

Technical ACK state, application ACK state and business lifecycle state are separate. PRODAT switch, termination and permission transitions require tenant-scoped correlation and idempotent writes. Unknown entities and master-data changes become proposals/review items. A message being parsed, validated or ACKed does not by itself mean that its business effect completed.
