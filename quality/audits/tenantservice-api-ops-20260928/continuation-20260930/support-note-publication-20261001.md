# Support notes and published phone-summary attribution

Date: 2026-10-01. Original requirements: T33 (internal notes remain internal across customer API/UI/webhook/notification) and T34 (published phone summaries identify their actual staff author and channel).

Status: actual exported T34 customer-message projection defect **REPRODUCED AND CORRECTED** in bounded pure/local-memory tests. Final **12/12 PASS**. T33 has bounded projector evidence only; unmatched support outbox/webhook/notifier consumers remain **OPEN**. New SQL forward is prepared, with **zero SQL/database/native executions** in this packet. No Auth, ordinary-user, privilege, security-boundary, credential, path, network or provider exercise was performed.

## Actual functional defect and correction

The current explicit publication boundary already preserves the selected staff author, authored body, phone/OPS channel and revision. OPS message history and portal current-summary cards have saved staff identity. However, `gridex_support_case_read_v1` selected only message ID/body/author-kind/channel/revision/time; `readCustomerSupportPage` returned the same limited customer DTO. The actual customer/API message history therefore had `author_kind: staff` and `channel: phone` but no reference to the actual staff author for that message. The portal per-message history displayed “Kundservice” and the channel without identifying that author.

Actual RED invokes the current exported `publishCustomerCase` and `readCustomerSupportPage` with only their outer persistence boundary controlled. An explicitly authored phone summary, saved staff UUID and publication revision are handed to the customer read shape; a distinct synthetic reading customer is used. The public body, staff-kind, phone channel and current case/message revision pass, but the actual projector returns no `author_reference`. Initial proof: 6 PASS/1 FAIL; expanded current consumer map: **7 PASS/1 FAIL**, exit 1, `/tmp/gridex-support-note-publication-red.log`. No canonical validation/Auth/SQL output was represented as executed.

The narrow correction adds a pure `publicSupportStaffReference` helper and includes `author_reference` in every customer message DTO. It uses the existing `publicReference('support_staff', companyId, savedActorUserId)` derivation only for a saved staff author UUID. Customer message authors, historical null authors and older receipts without author data return null. It never infers authorship from the reader, a label or a personal-profile field. The raw UUID is accepted only in the internal service read receipt and is omitted from the public DTO. No new staff name/profile/identity lookup was introduced.

Fresh CLI generation, exit 0, created `supabase/migrations/20261001030724_support_message_stored_staff_attribution.sql`. This forward changes only the existing service read's message SELECT: `CASE WHEN author_kind='staff' THEN actor_user_id ELSE NULL END AS actor_user_id`. Its exact catalog patch requires one occurrence of the current SELECT and preserves the same function definition, signature, language/invoker, all actor/clock/visibility/current-publication/pagination predicates, OID, owner, ACL and configuration. It performs no message update, writer change, grant/role change, historical backfill or identity relabelling. These are source properties; the migration has not been installed or executed in this packet.

## Agreed additive public shape

`CustomerSupportMessage.author_reference` is always present, with type `string | null`. A nonnull value follows `^support_staff_[A-Za-z0-9_-]{32}$`. Staff references come only from the actual stored author and company scope; customer and unknown historical authors are null. Existing message reference/body/author-kind/channel/revision/time fields remain. Current case `revision` remains the current support revision; a publication revision is a separate counter and is not substituted for it.

The parent owns the additive public contract and a new paired immutable release. Existing historical release JSON/routes are unchanged by this package. The requirements owner separately owns `app/portal/arenden/page.tsx` and its pagination correction; this packet does not edit that page. Per-message display of the new reference is therefore **OPEN / OWNER_COORDINATED** until that owner completes its separate rendering proof. The current portal summary-card author derivation is already the same saved-staff reference.

## Consumer evidence and explicit limits

| Surface | Actual source/exported behavior traced | Proof/status |
|---|---|---|
| Explicit publication | `lib/customer-cases/publication.ts` sends explicitly authored title/body, actual staff context, selected phone channel and expected revision; rejects stale revision or differently labelled returned channel. | Executed controlled persistence-boundary cases PASS. Actual current session/database installation remains outside this packet. |
| Customer message DTO | `lib/customer-cases/customerRead.ts` validates the closed read receipt, maps current case/message revisions, rejects an unexpected private-note field and omits raw staff UUID. Two saved staff authors have distinct stable references across repeated projections and company scopes; historical null/missing author remains null. | Actual exported publish→read and pure helper **12-case suite PASS**. No actual SQL read was executed. |
| API message route | `app/api/v1/customer/cases/[reference]/messages/route.ts` returns `page.items` from that same current exported read. | Source handoff traced. No served HTTP, API Auth or live customer role was exercised here. |
| Customer portal UI | Current summary cards use the saved publication author and channel; per-message history needs the new additive reference. The page/pagination owner has the exact mapping and retains current case/read pagination. | Existing source trace; new per-message render proof **OPEN / OWNER_COORDINATED**. No browser executed here. |
| OPS UI | `app/admin/customer-cases/page.tsx` distinguishes internal/customer messages and displays saved actor/channel/revision; explicit publication form has separate public title/body and selected channel, with no automatic private-note prefill. | Read-only source trace, no new OPS render/submit journey here. |
| Internal note producer / internal outbox | Current support command marks internal notes/phone drafts internal and writes public domain/outbox intent only in its explicit public branch. Publication creates a separate staff/customer-visible message linked to that publication. Outbox payload carries identifiers/revision rather than the private body. | Source trace only. No SQL/transaction/consumer execution here. A source census is not proof of the complete downstream bridge. |
| Public webhook projector | Actual `buildPublicWebhookPayload` drops unrelated private-note/phone-draft/next-action text from a registered `customer.updated` event. | Executed pure private canary PASS; no subscription/fanout/signing/network dispatch. |
| Support→webhook mapping | The exported registry does not recognize `customer.support.changed`; the actual projector explicitly rejects it. Existing webhook fanout reads the separate `domain_events` / `event_outbox` owner, while support SQL writes canonical events/outbox. | Pure unmatched projection PASS; the complete canonical support bridge is **OPEN / NOT_QUALIFIED**, not inferred absent or safe from searches. |
| Support notification mapping | Actual `notifyCustomerForLifecycleEvent` returns `event_not_mapped` for `customer.support.changed` before database/email work. Its mapped lifecycle templates are supplier-switch/supply events. | Executed unmapped branch PASS; no notifier/provider send. Support-specific consumer/current publication revalidation and private canary journey remain **OPEN**. |
| Realtime/cache/file projections | No complete matched same-case current-publication consumer journey was executed or qualified. | **OPEN / NOT_EXECUTED**; no broad private-note exclusion claim. |

## Verification receipts

- Final Node22 command: `npx vitest run --config /tmp/gridex-source-observer-unit.config.mts __tests__/support-note-publication-20261001.test.ts`.
- `/tmp/gridex-support-note-publication-green.log`: exit 0, **12/12 PASS**. The scratch-only config extends the real default setup and resolves only the pinned Next `server-only` marker to its genuine empty module; no domain behavior is supplied by it.
- ESLint on the exact DTO/helper/test files: exit 0, no errors/warnings. Final test-only lint is recorded in `/tmp/gridex-support-note-publication-final-lint.log`; source lint in `/tmp/gridex-support-note-publication-lint.log`.
- Scoped whitespace check: PASS. No broad TypeScript gate was launched while the parent ran current full gates; parent integration owns applicable types/schema/contract checks.
- SQL execution **0**, native/browser/served HTTP/provider execution **0**. No manufactured successful deployment, publication transaction, Auth or downstream delivery receipt is claimed.
- Independent requirements review reran the exact four source hashes under Node22: permitted pure/local-memory **12/12 PASS**, with no DB/Auth/role/native exercise. Its reported 05:15 run time is process-local Europe/Berlin (UTC+02), corresponding to approximately 03:15 UTC; Vitest's local display is not an absolute UTC receipt. Read-only SQL/DTO review confirmed the one-projection patch, preserved command identity/config/ACL/current predicates, saved-staff-only opaque reference, raw UUID exclusion and historical/customer null behavior. No concrete bounded source blocker was found; no page display acceptance was inferred.
- Existing frozen site/switch seventeen paths, the four adapter-report paths and the older source-authority documentation remain unchanged. The separate deeper legacy authority exercise remains blocked and was not resumed.

## Frozen source manifest

| Path | SHA256 |
|---|---|
| `lib/customer-cases/customerRead.ts` | `e16a4707714c064b19573f66f684c34d85436fc48be3ebe1a81ebd61195f9c8e` |
| `lib/customer-cases/supportStaffAttribution.ts` | `ac57bbdddde579eddb526c2cc6bac6b968fdde5bd5c6788192f65309f98de944` |
| `__tests__/support-note-publication-20261001.test.ts` | `7caf4e007d6ebc269607776b356feab1ef4f9fc79e99bf6aa4d16d4bcaed685f` |
| `supabase/migrations/20261001030724_support_message_stored_staff_attribution.sql` | `8b4622331205e766e4b123890b720f92457235996cfae52527d66ca01c0b626a` |

T34's missing per-message staff attribution is corrected and bounded locally. Its actual installed read, portal display, API release and current native journey remain separate pending outcomes. T33 remains partial until each matched downstream consumer's private-note/publication-revocation behavior has its own executed proof. This report does not close the whole original requirement inventory.
