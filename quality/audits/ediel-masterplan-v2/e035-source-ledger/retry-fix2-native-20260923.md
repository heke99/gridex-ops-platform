# Retry fix round2 actual native result

Head327ba7af213064d52d6d6c79e414a04fd24714cb, OPS35884310774,
native107260421275: 114 PASS / 10 FAIL of124,34.30s. Forward154221 applied.

The real catalog refresh succeeded: before snapshot was not ready at migration
20260813230000; final live catalog was ready with no blocking issues, and the
refreshed row matched at20260923154221. Both final live/saved fingerprints were
847a5728e6fd50db8e302917801e749febfc016cd7f96c58444513faf6b8b35a.
The existing application readiness guard was preserved and passed.

All ten remaining failures now reach actual domain-event insertion and fail
domain_events_actor_user_id_fkey. Native fixture calls pass f.ids.customer as
actorUserId, although it is a customer identity rather than an auth user.
This blocks four real writer/E30 positives and six new completion-gap cases
before their intended assertions. Preserve event writes and foreign keys;
seed a genuine disposable actor and use it consistently. Sole implementer
resumed focused fixture fix round3. No production defect inferred from this
fixture failure, and no positive/native acceptance claimed.

Type/schema generation still not reached. Artifact10762266897 log-only,
reported ZIP SHA256eb1e1928f68eefe909ebf61e977084a52f259c49709d073dc72e6c066f2f5a6e.
Independent fixround2 code review passed; actual positive execution and
authentic generated artifacts remain required before task acceptance.
