# Canonical avtals- och tenantlivscykel

Denna modell är normativ för databas, admin, externa API-routes, workers och
dokumentation. UI-status är aldrig en fristående källa.

## Avtal

| Status | Ny försäljning/API | Redigering | Återaktivering | Permanent radering |
|---|---|---|---|---|
| `draft` | Nej | Ja | Publiceras efter readiness | Ja, om dependency preview är grön |
| `ready` | Nej | Ja | Publiceras efter readiness | Ja, om dependency preview är grön |
| `published` | Ja i aktiva kanaler | Ny immutable version | — | Nej; avpublicera först |
| `paused` | Nej | Ny immutable version | Ja | Endast utan affärshistorik och aktiv kanal |
| `expired` | Nej | Ny immutable version | Nej | Endast utan affärshistorik |
| `closed` | Nej | Nej | Nej, terminal | Nej |
| `archived` | Nej | Nej | Nej | Nej när historik finns |
| `superseded` | Nej om ingen aktiv kanal | Nej | Nej; använd efterföljaren | Nej separat |

- `gridex_unpublish_contract_channel` stänger en kanal utan att ta bort
  publiceringsbehörigheten.
- `gridex_pause_contract_channels` pausar all nyförsäljning för versionen.
- `gridex_close_contract_product` stänger hela produktserien terminalt, avslutar
  kanaler och publiceringar, återkallar oanvända quotes och bevarar historik.
- `gridex_archive_contract_product` bevarar historik och döljer produktserien.
- `gridex_delete_unused_contract` får endast radera en tenantbunden, exklusiv
  graf vars dependency preview bevisar noll affärshistorik.

## Tenant

| Status | Extern API | Nya operativa writes | Historik |
|---|---|---|---|
| `onboarding` | Blockerad | Endast uppsättning | Läsbar |
| `active` | Tillåten enligt nyckel/scopes | Tillåten | Läsbar |
| `paused` | `423 tenant_paused` | Blockerad | Läsbar |
| `suspended` | `403 tenant_suspended` | Blockerad | Läsbar |
| `closed` | `410 tenant_closed` | Terminalt blockerad | Bevarad |
| `archived` / `pending_deletion` | `410 tenant_inactive` | Blockerad | Bevarad |

`gridex_transition_tenant_lifecycle` är enda kanoniska statusmutation.
Aktivering kör `gridex_tenant_activation_readiness` i samma transaktion och
returnerar strukturerade blockers. Stängning blockeras av aktiva kundavtal,
öppna leverantörsbyten eller ofärdig fakturering. Paus/stängning inaktiverar
API-klienter och försäljningskanaler atomiskt och skriver audit + outbox.

## Tenant-onboarding

`company_onboarding_lifecycle` är resumable och unik per tenant. Den kompletterar
den idempotenta checklistan `company_onboarding_tasks` med aktuellt steg,
avklarade steg, blockers och aktiveringsdatum. En upprepad aktivering skapar
inga nya tenant-, medlemskaps-, API-klient- eller onboardingposter.

Normal websiteintegration kräver endast:

```text
GRIDEX_API_URL
GRIDEX_API_KEY
```

Tenantidentitet och scopes härleds server-side från API-nyckeln. Externa
`company_id` eller tenant-ID accepteras inte som behörighetskälla.
