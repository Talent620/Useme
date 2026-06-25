# RadarPL — instalacja (binarki) i auto-aktualizacja

Gotowe pliki wykonywalne dla **Windows** i **Ubuntu/Linux** — bez instalowania Node.
Binarka **sama się aktualizuje** przy każdym nowym wydaniu, bez Twojej ingerencji.

## Pobieranie

Najnowsze wydanie: **[GitHub Releases](https://github.com/talent620/useme/releases/latest)**

| System | Plik | Jak uruchomić |
|---|---|---|
| Windows | `radar-windows.exe` | pobierz i uruchom (np. `radar-windows.exe auto`) |
| Ubuntu/Linux | `radar-linux` | `chmod +x radar-linux && ./radar-linux auto` |
| Android | `radar-android.apk` | zainstaluj (zezwól na „nieznane źródła") — mobilny panel operatora |

> **Android (APK):** to panel sterowania — agent wykonuje zlecenia w chmurze/na
> serwerze, a aplikacja pokazuje leady i status (podajesz adres swojego RadarPL).
> Pełna autonomia (cron, egzekucja) działa na desktopie/serwerze (`auto`/`loop`).

> Sumy kontrolne: `SHA256SUMS.txt` w tym samym wydaniu (`sha256sum -c SHA256SUMS.txt`).

### Pierwsze uruchomienie
Przy pierwszym starcie binarka tworzy edytowalny `config/tenants.json` obok siebie
(profil + ICP + źródła). Uzupełnij go i gotowe.

```bash
./radar-linux version          # wersja
./radar-linux onboard --email ty@x.pl --headline "Co robisz" --register
./radar-linux loop             # autonomiczny tryb (cykl + auto-update)
```

## Auto-aktualizacja (bez ingerencji)

Wbudowany updater pilnuje, byś zawsze miał najnowszą wersję:

- **Tryb `loop` (daemon)** sprawdza GitHub Releases **maks. raz na 24h**, pobiera
  binarkę pasującą do Twojego systemu i **przygotowuje ją w tle** (`radar-…​.new`).
- Przy **następnym starcie** (lub kolejnej iteracji daemona) nowa wersja jest
  **podmieniana automatycznie** — Windows i Linux obsłużone (atomowy rename).
- Ręcznie w dowolnym momencie: `./radar-linux update`.

Wyłączenie: `RADAR_NO_UPDATE=1`. Inne repo źródłowe: `RADAR_UPDATE_REPO=owner/name`.

### Jak to działa technicznie
1. `checkAndStage()` — pobiera `releases/latest`, porównuje semver, wybiera asset dla OS,
   pobiera do `<binarka>.new`.
2. `applyStagedUpdate()` — przy starcie: `binarka → binarka.old`, `binarka.new → binarka`
   (na Windows nie da się usunąć działającego pliku, ale można go przenieść — stąd rename).
3. Throttling znacznikiem czasu (`data/update-check`), więc brak zbędnych zapytań.

Logika jest pokryta testami (`agent/test/updater.test.ts`).

## Budowanie binarek samodzielnie

Wymaga [Bun](https://bun.sh) (cross-compiler):
```bash
cd radar
bun run build:bin            # -> dist/radar-linux, dist/radar-windows.exe
```
W CI robi to workflow `.github/workflows/release.yml` na push tagu `vX.Y.Z`:
buduje oba systemy, liczy sumy SHA256 i publikuje w Releases.

## Wydanie nowej wersji (dla maintainera)
```bash
git tag v0.1.1 && git push origin v0.1.1
```
Workflow zbuduje i opublikuje binarki; instancje w trybie `loop` zaktualizują się same.
