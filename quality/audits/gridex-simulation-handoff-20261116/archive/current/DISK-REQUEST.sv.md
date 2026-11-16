# Begäran om mer lagring för Gridex OPS-testmiljön

Verifierat 2026-11-16 i den aktiva körmiljön:

- `/workspace` och `/var/lib/docker` delar samma overlay-disk: 31,5 GiB totalt.
- `/tmp` är tmpfs: 8,8 GiB och belastar miljöns RAM.
- Dockerdrivrutinen är `vfs`. En verklig containerkonstruktion utan start överskred30s; samma begäran registrerades senare som skapad. Ingen DB/Auth/SDK kördes.
- Den pinnade Storage-avbilden rapporterar820464664 logiska byte. Vid borttagning av exakt den egna aldrig startade containern observerades2244390912 byte frigjort rått diskspace. Det är en observation, inte en exklusiv allokering eller garanterad toppgräns.

## Text till miljöleverantör eller administratör

Utöka den aktiva Codex-körmiljöns gemensamma lagring för `/workspace` och `/var/lib/docker` från31,5GiB till minst100GiB. Lägg till minst30GiB separat DISKBASERAD scratch-lagring för temporära testfiler. Bevara den aktuella miljöns filer, Git-arbetskopior och Docker-volymer vid utökningen. Om plattformen kräver en ny miljö ska befintlig lokal testdatabas och privata testunderlag först säkras och en kontrollerad överlämning göras.

För en NY miljö önskas en lagringsdrivrutin som undviker vfs fullständiga kopior, exempelvis en av plattformen stödd overlay-lösning. Ändra inte drivrutin på den aktiva datakatalogen utan planerad migrering.

## Självservice och kapabiliteter

Miljöstatus anger leverantör `cloud`. De tillgängliga verktygen erbjuder inte diskresize eller ny diskmontering. Inställningsdokumentationen beskriver repo/nätverk/variabler/hemligheter men ingen verifierad diskknapp. Därför anges ingen påhittad knappväg. Ägaren eller leverantören behöver exponera större disk eller en lämplig ny körmiljö.

Nuvarande originalscenarier43PASS/1GAP/61ofullständiga påverkas inte av denna lagringsbegäran. Enbart konstruktion av testinfrastruktur räknas inte som ett körresultat för EDIEL-fallen.
