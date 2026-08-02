# Verification protocol

## Local gates

```bash
export PATH=/path/to/node-22/bin:$PATH
npm ci
npm run lint
npm run typecheck
npm run typecheck:scripts
npm run typecheck:tests
npm test
npm run db:migrations:integrity
npm run ops:canonical-production-hardening
npm run ops:hardening-behavior-regression
npm run ops:hardening-regression
npm run ediel:routing-security-regression
npm run ediel:inbound-tenant-resolution-regression
npm run security:rbac
npm run security:audit-production
npm run build
```

## Staging database gates

- idempotent reapply where intended;
- same key + same payload returns one result/event;
- same key + different payload fails;
- unauthorized/banned/inactive/tenant-bound platform actor fails;
- last functioning owner and admin cannot be removed;
- partial profile update preserves absent fields, explicit null clears present fields;
- readiness read creates no snapshot;
- profile/route/cert/rule change makes prior evidence stale;
- production evidence cannot satisfy test result;
- tenant A cannot read/write tenant B under real JWTs;
- service-role RPC rejects forged actor identity;
- workers block both at claim and immediately before transport.

Local static checks may be PASS. Database, JWT/RLS, concurrency and external transport checks remain **NOT VERIFIED** until staging execution.
