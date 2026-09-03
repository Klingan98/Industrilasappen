# Industrilåsappen

En mobilanpassad orderkalkyl för montering. Appen räknar återstående stycken, kartonger, arbetstid och beräknad sluttid med hänsyn till raster, arbetsdagar och flera medarbetare.

## Funktioner

- Ledtid per styck i sekunder eller minuter
- 20 % standardtillägg på orderns totala originaltid
- Ange färdiga kartonger och lösa stycken som redan var klara före orderstart
- Uppdatering efter varje kartong eller valfritt antal lösa stycken
- Prognos enligt originaltid och uppmätt persontakt
- Flera medarbetare med egna start- och sluttider
- Standardtider 07:00–16:00 med raster 09:15–09:30, 11:00–11:15 och 13:30–14:10
- Lördagar och söndagar hoppas över
- Arbetstider, raster, arbetsdagar och tillägg kan ändras i inställningarna
- Lokal lagring, säkerhetskopia och offline-stöd
- Installerbar på iPhone via **Lägg till på hemskärmen**

All orderdata sparas lokalt i webbläsaren och skickas inte till GitHub.

## Testa lokalt

Kör följande från projektmappen:

```bash
python3 -m http.server 8000
```

Öppna sedan `http://localhost:8000`.

Kontrollera beräkningarna med:

```bash
npm test
npm run check
```

## Publicera med GitHub Pages

1. Skapa ett nytt repository på GitHub.
2. Lägg in projektets filer och skicka dem till grenen `main`.
3. Öppna **Settings → Pages** i repositoryt.
4. Välj **GitHub Actions** som källa under Build and deployment. Webbappen ligger direkt i repositoryts rot.
5. Vänta tills arbetsflödet **Publicera Industrilåsappen** är klart.

GitHub visar därefter adressen till appen.

## Lägg till på iPhone

1. Öppna appens adress i Safari.
2. Tryck på **Dela**.
3. Välj **Lägg till på hemskärmen**.
4. Aktivera **Öppna som webbapp** och tryck på **Lägg till**.

## Beräkningsprincip

```text
Original totaltid = orderantal × originalledtid per styck
Tillägg = original totaltid × vald procentsats
Planerad totaltid = original totaltid + tillägg
```

Schemalagda raster räknas inte som produktionstid. Faktisk persontakt bygger på registrerad arbetstid och får därför inget extra procentpåslag.

### Färdigt före start

När en order startas kan ett startsaldo anges som färdiga kartonger och/eller lösa färdiga stycken. Startsaldot räknas direkt in i orderns framsteg och minskar återstående mängd och prognostiserad tid. Det räknas däremot inte som producerade stycken i taktuppföljningen. Faktisk persontid per styck baseras bara på det som registreras efter att ordern har startats.
