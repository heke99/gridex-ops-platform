# Work plan — aktuell leveransordning

1. Läs faktisk main, [current-state](current-state.md), fryst eget krav och senaste [#766](https://github.com/heke99/gridex-ops-platform/issues/766). Kontrollera om PR:en redan är mergad och vem som håller exakta refs.
2. Fortsätt befintligt paket. Extra granskare får läsa direkt; extra kodskrivare behöver avgränsad filöverlämning före ytterligare write. Ingen återstart av gamla agenter eller parallell producent.
3. Återanvänd affected source-closures för #784 e6/#785 dbab/#787 ac/#788 5e; starta inte om de rättade fynden. Kvalificera kvarvarande forwardpins/GEN, #784:s fysiska ERR-orakel med levererad #789 och aktuell CI/leverans. C2 rättar dessutom #790:s accepterade S18-historikregression och repinnar/GEN före ny sourcegranskning; skydda fortsatt aktuell auth och verkliga source/DB-fel. #785-godkännandet gäller deklarerat operatorläst Gmail, inte generell raw-header-tillit.
4. C2 förenar granskade forwardinputs med levererad SC053/main och utför en seriell canonical GEN/capture åt gången. Helpers skriver inte en parallell manifestpin. R1:s legal-only donor staplas inte blint med den bredare #788-helpern.
5. Kvalificera aktuellt originalutfall genom samma R1 DB05/C1 Z02/C3 H/C2 UTILTS-Z10M-kedjor. C3 konsumerar R1:s samma DB05. Avgränsade mekanismbevis uppfyller inte automatiskt hela frysta ID.
6. Två slutpeers som inte medförfattat, aktuella mandatorygates och relevant genuint bevis före normal expected-head merge. Autentisera faktisk PR/main/föräldrar/träd/ledger; frigör egen mergeroll först och bara rätt receiptbundna resurser därefter.
7. Uppdatera eget checkpoint och #766. Samordnaren reconcilerar delade startdokument under role-memory/exakta filrefs; nästa agent läser faktisk status före sitt paket.

314/352 är faktisk ledger vid observationen; #785:s 315 är ett öppet förslag. Externa retention/motpart/LIVE-kriterier begränsar helgodkännandet men stoppar inte oberoende källrättning. #310 förblir PAUSED.
