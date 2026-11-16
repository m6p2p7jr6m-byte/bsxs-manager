# BSXS Manager

Centrum zarządzania karierą XARO i kolektywu BSXS: utwory, wydawnictwa, sesje studyjne, finanse, zadania, kolektyw, integracja REAPER oraz pełna diagnostyka.

Aplikacja jest **lokalna i offline-first**: cała baza żyje w pamięci trwałej przeglądarki (localStorage), nie ma backendu, analityki ani zewnętrznych usług. Kod jest zbudowany z modułów ES bez procesu budowania.

## Uruchomienie

- Publikacja: przycisk **Run** w aplikacji (podgląd `*.freemilk.app`).
- Alternatywnie: **GitHub Pages** — po wypchnięciu na GitHub workflow `.github/workflows/pages.yml` publikuje stronę automatycznie przy każdym pushu na `main` (adres: `https://<konto>.github.io/<repozytorium>/`). Ta droga nie zależy od limitów podglądu FreeMilk.
- Wymaga HTTPS — kryptografia (Web Crypto) i service worker działają tylko w bezpiecznym kontekście.
- Pierwsze uruchomienie zakłada konto właściciela i generuje jednorazowy kod odzyskiwania.

## Moduły

| Moduł | Zawartość |
| --- | --- |
| Pulpit | podsumowanie, wykresy, najbliższe zadania, skróty, dane demonstracyjne |
| Utwory | katalog z walidacją, filtry, sortowanie, paginacja, autozapis szkicu nowego utworu |
| Wydawnictwa | single/EP/albumy, statusy, powiązania z utworami |
| Studio | sesje nagraniowe, godziny, stawki, koszty |
| Mix Master | plan miksu i masteringu (lokalny asystent AI), 67 wtyczek (premium i wbudowane) z zestawami dla raperów, gotowe łańcuchy `.RfxChain` i paczka ZIP do REAPERa |
| Finanse | przychody i koszty, bilans, wykres 6 miesięcy, rozliczenia |
| Zadania | szybkie dodawanie, priorytety, terminy, oznaczanie jako zrobione |
| Kolektyw | osoby, role, kontakt, zgody marketingowe |
| REAPER | lista dozwolonych folderów, import/eksport manifestu JSON, walidacja ścieżek |
| Diagnostyka | logi, błędy, historia awarii, czasy odpowiedzi, stan modułów, testy, raport, eksport logów |
| Bezpieczeństwo | hasło, MFA (TOTP), sesje, użytkownicy i role, blokady, polityka |
| Prywatność | podgląd i eksport danych, import kopii, zgody, usunięcie konta i danych |
| Ustawienia | animacje, paginacja, autozapis, magazyn, migawki i kopie zapasowe |

## Bezpieczeństwo

- **Hasła**: PBKDF2-HMAC-SHA256, 600 000 iteracji, losowa sól 128 bitów, porównanie w stałym czasie.
- **Sesje**: token 256-bitowy, w bazie wyłącznie jego hash SHA-256; limit bezczynności 30 min, czas absolutny 8 h, unieważnianie przy wylogowaniu, zmianie hasła i zmianie roli.
- **Blokada konta**: 5 nieudanych prób → 15 min blokady; licznik trwały (przetrwa odświeżenie).
- **MFA**: opcjonalny TOTP (RFC 6238); sekret zaszyfrowany AES-GCM 256 kluczem z hasła (PBKDF2, 150 000 iteracji).
- **Odzyskiwanie**: jednorazowy kod odzyskiwania (20 znaków, 80 bitów losowości), przechowywany jako hash; reset unieważnia sesje i wyłącza MFA.
- **Role**: owner / admin / member / viewer, macierz uprawnień per moduł, `assertCan` przy każdej operacji zapisu, blokada samodzielnej eskalacji i odebrania roli ostatniemu właścicielowi.
- **Dane**: brak `innerHTML` dla treści użytkownika (tylko `textContent`), walidacja wszystkich formularzy, brak `eval`, brak wykonywania poleceń systemowych.
- **Kopie**: eksport jawny bez haseł/tokenów, eksport szyfrowany AES-GCM 256, migawki lokalne (3 sloty) i dzienna kopia automatyczna.
- **Logi**: redakcja pól wrażliwych (hasło, token, sekret, klucz API, MFA), brak zapisu wartości sekretów.

## Mix Master i REAPER

- **Asystent AI działa lokalnie**: plan liczy silnik reguł na urządzeniu (BPM, styl, tonacja, platforma). Żadne nagranie, tekst ani notatka nie są wysyłane do zewnętrznego modelu.
- **Plan** zawiera kolejność wtyczek, ustawienia startowe i cel głośności (LUFS / True Peak) dla Spotify, YouTube, Apple Music, TikToka i klubu; style: trap, drill, boom-bap, melodyjny, afro, phonk, rage.
- **Wtyczki**: 67 pozycji — wtyczki premium używane w rapowym miksie (FabFilter, Antares Auto-Tune, Waves, Plugin Alliance, Soundtoys, Valhalla, Kilohearts, Xfer, iZotope, Baby Audio, Sonnox, TDR, oeksound, XLN Audio, Cradle, Cableguys) oraz wbudowane wtyczki REAPERa, plus 5 zestawów tematycznych (startowy, wokal, beat, master, FX).
- **Łańcuchy FX**: moduł generuje pliki `.RfxChain` (wokal, beat, bus miksowy, master, sends) w dwóch wariantach — `premium` i `stock` (wyłącznie wtyczki wbudowane REAPERa, działa od razu). Plik przenosi kolejność wtyczek; ustawienia parametryczne są w planie i recepcie `.md`.
- **Pobieranie wszystkiego**: przycisk „Pobierz wszystko (ZIP)” buduje na urządzeniu paczkę (archiwum ZIP bez kompresji, własny zapis w `js/core/zip.js`) z 10 łańcuchami, dwoma pakietami JSON, receptą `.md` i instrukcją `README.txt`. Każdy plik można też pobrać osobno; jest wgląd w treść pliku przed pobraniem.
- **Import**: przeciągnięcie pliku na ścieżkę albo FX → Add FX → Import FX chain. Brakującą wtyczkę REAPER pokazuje jako niedostępną — nie jest to błąd aplikacji.
- **Bezpieczeństwo plików**: nazwy plików w paczce są walidowane (bez `/`, `..` i znaków kontrolnych), więc archiwum nie może wyjść poza katalog po rozpakowaniu. Katalog prowadzi wyłącznie do oficjalnych stron producentów — aplikacja nie pobiera, nie instaluje i nie licencjonuje wtyczek.

## Odporność i wydajność

- Każdy zapis to atomowa mutacja kopii roboczej: nieudana walidacja nie psuje danych.
- Odczytywanie stanu z awaryjnym łańcuchem: stan główny → kopia safety → 3 migawki → pusty stan z raportem; uszkodzone dane są zachowywane do wglądu.
- **Leniwe ładowanie modułów**: start pobiera tylko rdzeń i ekran logowania, a kod zakładki wczytuje się przy pierwszym otwarciu (z szkieletem widoku, bez blokowania interfejsu). Rejestr metadanych jest w `js/modules/registry.js`, a zgodność z modułami sprawdza test regresyjny.
- `modulepreload` dla rdzenia w `index.html` — przeglądarka pobiera zależności równolegle, zamiast odkrywać je warstwa po warstwie.
- **Spójność wersji modułów**: moduł Mix Master importuje silnik i zapis ZIP z `?v=2`, a router po błędzie importu robi jedno automatyczne przeładowanie (z blokadą pętli) i pokazuje przycisk „Odśwież aplikację”.
- **Diagnostyka niezależna od testów**: zestaw testów jest wczytywany dopiero po naciśnięciu „Uruchom testy”, więc błąd w testach nie blokuje już widoku Diagnostyki (wcześniej import był statyczny).
- **Service worker**: wszystko (HTML, JS, CSS) natychmiast z cache z odświeżaniem w tle — start nie wysyła już serii zapytań, co chroni też limit ruchu podglądu. Jeśli nowej kopii offline nie da się zapisać, instalacja jest przerywana i zostaje poprzednia wersja.
- **Krytyczne CSS inline**: ekran startowy ma własne, minimalne style w `index.html`, więc pierwsze malowanie nie czeka na `css/app.css`.
- **Ekran logowania i szkielet aplikacji ładowane leniwie**: pobierany jest tylko ten, który jest potrzebny, a po zalogowaniu nie ma już szkieletu widoku.
- **Mniej pracy przy starcie**: pierwszy zapis stanu nie duplikuje danych do kopii safety, a migawka dzienna powstaje po pierwszym renderze (`requestIdleCallback`). Czas startu jest mierzony i logowany (`Interfejs gotowy`, `start aplikacji`).
- Autozapis z konfigurowalnym opóźnieniem, wymuszony zapis przy ukryciu karty i ostrzeżenie przed zamknięciem z niezapisanymi zmianami.
- Listy paginowane, wyszukiwanie z debounce, wykresy i przejścia wyłącznie na `transform`/`opacity`.
- Trzy tryby animacji (włączone / ograniczone / wyłączone) respektujące systemowe ograniczenie ruchu.
- Obsługa klawiatur i czytników ekranu: etykiety, `aria-live`, pułapka fokusu w modalach, skip-link, widoczny fokus.

## Testy

Testy uruchamiasz w aplikacji: **Diagnostyka → Uruchom testy** (albo automatycznie pod adresem `?autotest=1`). Wynik trafia do diagnostyki ze znacznikiem czasu i jest dołączany do raportu.

Zakres: kryptografia (w tym wektory RFC 6238 i RFC 4226), walidacja danych, magazyn (odzyskiwanie po uszkodzeniu, zachowanie uszkodzonych danych, rotacja i przywracanie migawek), autoryzacja i role, sesje (blokada po nieudanych próbach, wylogowanie, zmiana hasła, reset kodem odzyskiwania, unieważnianie sesji), kopie zapasowe (eksport jawny i szyfrowany, odrzucanie niepełnych kopii), silnik miksu i katalog wtyczek, zapis ZIP paczki oraz zestaw regresji. Testy działają na osobnych magazynach w pamięci i nie dotykają danych użytkownika.

Raport diagnostyczny jawnie pokazuje, czy testy zostały uruchomione: brak uruchomienia nie jest prezentowany jako sukces.

## Ograniczenia (świadome)

- Aplikacja nie ma serwera: kontrola dostępu działa w warstwie danych w przeglądarce. Przy przyszłej synchronizacji autoryzacja musi zostać powtórzona po stronie serwera.
- Integracja z REAPER wymienia **wyłącznie metadane** (manifest JSON). Aplikacja nie uruchamia skryptów, nie czyta ani nie usuwa plików audio i projektów.
- localStorage jest ograniczony pojemnością przeglądarki; przy dużych zbiorach należy korzystać z szyfrowanych kopii zapasowych.
- Brak zewnętrznych modeli AI i usług — zgody w module Prywatność są domyślnie wyłączone i nic nie jest wysyłane. Asystent w module Mix Master to lokalny silnik reguł, nie model językowy.
- Wtyczki audio nie są częścią aplikacji: katalog i plan wskazują producentów i ustawienia, a pliki `.RfxChain` wczytują wyłącznie zainstalowane wtyczki.

## Struktura

```
index.html            powłoka aplikacji
css/app.css           system projektowy
js/core/              kryptografia, magazyn, sesje, autoryzacja, logi, diagnostyka, UI, router, silnik miksu, zapis ZIP
js/ui/                szkielet aplikacji, ekran logowania, elementy stron
js/modules/           moduły biznesowe + rejestr metadanych (registry.js)
js/tests/             harness i zestawy testów
sw.js                 tryb offline (wszystko cache-first z odświeżaniem w tle)
```
