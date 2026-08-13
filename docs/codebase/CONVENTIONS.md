# Conventions

- Forward-only migrations; historical applied SQL is checksum-pinned.
- Fail closed on missing tenant, route, permission or canonical rule data.
- Persist `company_id` on tenant-owned records and scope every mutation.
- Use test-first changes and repository regression scripts.
- Do not present queued work as externally delivered or ACKed work as business-complete.
