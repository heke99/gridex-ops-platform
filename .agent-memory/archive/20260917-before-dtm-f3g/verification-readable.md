# Readable view of the preserved PR326 verification checkpoint

This is a presentation-only companion to `current-state.md` and `current-task.md`.
Those two historical snapshots are kept byte-for-byte as copied from main
`31b4dbeb764874e252e8b6b510bf1fa78832f148`, as required by this archive's README.
The following reformats their verification paragraph; it does not add evidence or
claim that those historical results belong to the current DTM candidate.

The four fixes and **87 new regression cases** were implemented locally.
Against the unchanged old source: **30 passed; 57 failed**. After correction:
**87 passed**. Full Vitest: **1,434 / 1,434**. Retained source cases:
**848 / 848**. All **3 TypeScript groups** passed. Changed-file ESLint:
**0 errors; 8 retained warnings**. Golden-path, route, integrity and unchanged
large-source-budget checks passed.

The old checkpoint was pre-publication. PR326's later merge is independently
recorded by GitHub; this companion is neither PR327 evidence nor release approval.
