# Ediel elbolag live runbook

Detta är den operativa målprocessen för att köra ett elbolag live i Ediel utan att blanda test, AGT och production.

## Enkel process

1. **Välj bolag och roll**
   - Välj tenant/bolag.
   - Välj roll: `supplier`/DDQ för elbolag eller `esco`/DGI för energitjänsteföretag.
   - Kontrollera att aktörsnamn och Ediel-ID kommer från `ediel_actor_settings`.

2. **Spara testsetup**
   - Skapar test-aktör med `actor_name`, `actor_ediel_id`, roll och mailbox.
   - Skapar TGT-route profiles för PRODAT/UTILTS med `environment_type=tgt_test`.
   - Sparar systemtestportal i `ediel_system_test_settings`.
   - Får inte markera AGT eller production som klara.

3. **Kör TGT/systemtester**
   - Kör ett testfall åt gången.
   - Alla runs/messages ska vara scopade till valt `company_id`.
   - Inbound synkas med explicit testfallskod.

4. **Kör AGT/aktörstest**
   - AGT-readiness ska vara separat från TGT setup.
   - AGT får bara startas när TGT/systemkombinationen är godkänd för samma bolag, roll och message family.

5. **Konfigurera production**
   - Production actor settings ska finnas med aktivt Ediel-ID.
   - Production route ska vara separat från test-route.
   - Production route profile ska ha:
     - `environment=production`
     - `environment_type=production`
     - `is_production_route=true`
     - `production_mode=shadow` tills aktivering
     - `encryption_mode=smime`
     - `tls_required=true`
     - `transport_profile_id`
     - giltigt S/MIME-certifikat

6. **Kör production readiness**
   - Alla blockerande issues måste vara borta.
   - Readiness ska kontrollera tenant, actor, route, mailbox, certifikat, transportprofil, clock health, unresolved items och send-lock.

7. **Kör production dry run**
   - Dry run måste vara `allowed` eller `warning` innan live kan aktiveras.

8. **Aktivera live**
   - Kräver superadmin.
   - Kräver exakt bekräftelse: `ACTIVATE PRODUCTION`.
   - Låser upp production-send först efter godkänd readiness och dry run.

9. **Godkänn första live-send**
   - Första production outbound kräver explicit första-send-godkännande, om bolaget inte redan har skickat production tidigare.

10. **Övervaka live**
    - Följ outbound queue, inbound ACK, dead-letter, retries, negative APERAK och audit events.

## Stop-regler

Production ska blockeras om något av detta gäller:

- Test-Ediel-ID `91100` eller `91109` används i production.
- Testmailbox eller `@ediel.se` används som production target.
- `company_id` saknas på production message.
- Production actor settings saknas eller matchar inte avsändarens Ediel-ID.
- Route/profile tillhör annat bolag.
- `transport_profile_id` saknas på production route profile.
- S/MIME saknas, certifikat är saknat/ogiltigt/kritiskt nära utgång, eller TLS saknas.
- Production dry run saknas.
- Production send-lock är aktiv.
- Bolaget är pausat, suspenderat eller arkiverat.

## Verifiering per release

Kör alltid:

```bash
npm run typecheck
npm run lint
npm run ediel:rule-regression
npm run ediel:production-readiness-regression
```

Smoke-testa:

- ESCO simple setup.
- Supplier simple setup.
- S/MIME utan certifikat blockeras.
- TGT-run skapas med `company_id` och `environment_type=tgt_test`.
- Case-sidan behåller `companyId` i länkar/formulär.
- Production activation blockeras utan dry run.
- Production readiness blockeras utan transportprofil/certifikat.
