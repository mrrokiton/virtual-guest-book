# Wirtualna księga gości weselnych: plan MVP

Status: ZATWIERDZONY (26.09.2026). Etapy 0–11 zaimplementowane w kodzie. Otwarte: uruchomienie E2E
(wymaga Dockera lokalnie lub CI), wdrożenie na staging/produkcję i test k6 (wymagają kont i danych
dostępowych), formalny przegląd `/cso`.

Legenda: `[ ]` do zrobienia, `[~]` w toku, `[x]` gotowe, `[-]` pominięte (z uzasadnieniem).

## Zatwierdzone decyzje

- Model: SaaS. Pary same się rejestrują. Płatności po MVP, ale model danych (konto, plan, limity) je przewiduje.
- Dostęp gościa: link z kodu QR z nieodgadywalnym `slug` plus PIN wesela (6 znaków, limit prób). Po podaniu PIN-u gość dostaje podpisane ciasteczko sesji ważne tylko dla tego wesela.
- Moderacja: zdjęcia widoczne od razu, administrator ukrywa lub usuwa je po fakcie. Gość może usunąć własne zdjęcie (identyfikator urządzenia).
- Media: zdjęcia i krótkie wideo (do 60 s, limit per plan).
- Retencja: stały okres aktywności, potem tryb tylko do odczytu, paczka ZIP dla pary i automatyczne usunięcie.
- Kształt aplikacji: monorepo pnpm, Next.js (App Router) jako modularny monolit oraz osobny `apps/worker`.
- Hosting: Fly.io w regionie UE (fra/ams). Aktualizacje na żywo: SSE z Postgres `LISTEN/NOTIFY`, fallback na odpytywanie.
- Wideo: Cloudflare Stream (Mux jako zapasowa opcja).
- Separacja danych: wspólny schemat z `wedding_id`, filtrowanie wymuszone w warstwie dostępu do danych i testy izolacji.
- Stos: TypeScript, Drizzle, PostgreSQL (Neon, Frankfurt), Cloudflare R2, pg-boss, sharp, Better Auth, Tailwind + shadcn/ui, Zod, Resend, Sentry, Vitest, Playwright, k6, GitHub Actions.

## Struktura repozytorium

- `apps/web`: Next.js (strefa gościa, panel administratora, API, SSE, webhooki).
- `apps/worker`: pg-boss (obróbka zdjęć, ZIP, retencja, twarde usuwanie).
- `packages/db`: schemat Drizzle, migracje, warstwa dostępu z filtrem po weselu.
- `packages/core`: reguły domenowe niezależne od frameworka.
- `packages/services`: konfiguracja, storage, wideo, e-mail (dodany, patrz odstępstwa).
- `packages/modules/*`: przyszłe moduły włączane przez tabelę `wedding_modules`.

## Etapy MVP

### Etap 0: Fundamenty repozytorium

- [x] `git init`, `.gitignore`, `.editorconfig`, `README.md` (repozytorium bez commitów: commity zostawione właścicielowi)
- [x] Monorepo pnpm (`pnpm-workspace.yaml`), wspólny `tsconfig` w trybie strict
- [x] ESLint + Prettier
- [x] Vitest (testy jednostkowe i integracyjne), Playwright (E2E)
- [x] `docker-compose.yml` z Postgresem i MinIO do pracy lokalnej (+ Mailpit)
- [x] Walidacja zmiennych środowiskowych przez Zod, `.env.example`
- [x] CI w GitHub Actions: lint, typecheck, testy, build (+ job E2E na docker compose)
- **Gotowe, gdy:** `pnpm lint && pnpm typecheck && pnpm test && pnpm build` przechodzi lokalnie i w CI. Lokalnie: przechodzi (48 testów). CI: do potwierdzenia po pierwszym pushu.

### Etap 1: Model danych i domena

- [x] Tabele (nazwy zmienione, patrz odstępstwa) + tabele Better Auth
- [x] Migracje Drizzle
- [x] Maszyna stanów wesela: `draft` -> `active` -> `read_only` -> `archived` -> `pending_deletion` -> `deleted`
- [x] Warstwa dostępu do danych z obowiązkowym kontekstem wesela (`weddingScope`) + reguła ESLint blokująca bezpośredni import Drizzle w aplikacjach
- [x] Reguły domenowe w `packages/core` (uprawnienia, limity planu, przejścia stanów)
- **Gotowe, gdy:** migracje przechodzą, a testy izolacji potwierdzają, że zapytania w kontekście wesela A nigdy nie zwracają danych wesela B. Spełnione (PGlite).

### Etap 2: Uwierzytelnianie administratorów

- [x] Better Auth: rejestracja, weryfikacja e-mail, logowanie hasłem i linkiem z maila, reset hasła
- [x] Role `superadmin` (tabela `platform_admins`), `owner`, `co_admin`
- [x] Skrypt zakładający konto superadmina
- **Gotowe, gdy:** testy E2E rejestracji i logowania przechodzą, a testy uprawnień blokują dostęp między kontami. Testy napisane (`apps/web/e2e`), czekają na uruchomienie.

### Etap 3: Panel administratora

- [x] Tworzenie wesela, generowanie `slug` i PIN-u (PIN szyfrowany, nie hashowany: patrz odstępstwa)
- [x] Kod QR do druku (PNG / strona do druku z PIN-em)
- [x] Ustawienia: nazwa, data, okno aktywności, motyw
- [x] Zapraszanie współadministratora
- [x] Minimalny panel superadmina: lista kont i wesel, blokowanie wesela
- **Gotowe, gdy:** para przechodzi od rejestracji do kodu QR gotowego do druku w teście E2E. Test napisany, czeka na uruchomienie.

### Etap 4: Wejście gościa

- [x] Strona `/w/[slug]`, formularz PIN-u
- [x] Limit prób PIN-u na IP i na wesele (licznik w Postgresie)
- [x] Sesja gościa (podpisane ciasteczko `httpOnly`, identyfikator urządzenia), opcjonalne imię, zgoda na regulamin
- [x] Nagłówki bezpieczeństwa, CSP, `noindex`
- **Gotowe, gdy:** błędny PIN i zbyt wiele prób zwracają poprawne kody odpowiedzi, a gość bez sesji nie dostaje żadnych danych galerii. Pokryte testem E2E (401/429, brak danych bez sesji).

### Etap 5: Upload zdjęć

- [x] Kompresja na telefonie (do ~4096 px)
- [x] Podpisany adres PUT do R2, endpoint potwierdzenia uploadu
- [x] Kolejka wysyłek z ponawianiem i widocznym postępem
- [x] Worker: weryfikacja formatu po zawartości, HEIC -> JPEG, usunięcie EXIF/GPS, miniatury 400 px i 1600 px (+ wariant 4096 px bez metadanych do pobrania i ZIP)
- [x] Limity rozmiaru i liczby plików per plan
- **Gotowe, gdy:** zdjęcie HEIC i JPEG pojawia się w galerii bez GPS w metadanych, a plik z podmienionym rozszerzeniem zostaje odrzucony. JPEG i podmieniony plik: testy jednostkowe workera + E2E. HEIC: brak pliku testowego z iPhone'a, do ręcznej weryfikacji.

### Etap 6: Upload wideo

- [x] Upload bezpośrednio do Cloudflare Stream, `maxDurationSeconds` (bez TUS: patrz odstępstwa)
- [x] Sprawdzenie długości po stronie telefonu
- [x] Webhook z weryfikacją podpisu, miniatura, pobieranie MP4 (na potrzeby ZIP)
- **Gotowe, gdy:** klip 60 s trafia do galerii po przetworzeniu, a klip powyżej limitu zostaje odrzucony. Wymaga konta Cloudflare Stream; lokalnie działa tryb `VIDEO_PROVIDER=local`.

### Etap 7: Galeria i aktualizacje na żywo

- [x] Stronicowanie kursorem, przewijanie bez końca, podgląd pełnoekranowy, odtwarzacz wideo
- [x] Podpisane adresy do plików (10 min, przekierowanie po autoryzacji)
- [x] SSE z `LISTEN/NOTIFY`, fallback: odpytywanie co 10 s
- **Gotowe, gdy:** nowe zdjęcie pojawia się u drugiego gościa w ciągu 5 s bez odświeżania. Pokryte testem E2E (drugi gość bez przeładowania).

### Etap 8: Moderacja i usuwanie

- [x] Administrator ukrywa / usuwa pojedyncze i zaznaczone zdjęcia
- [x] Gość usuwa własne zdjęcie
- [x] Miękkie usunięcie + zadanie twardego usunięcia w R2 i Stream
- [x] Usunięcie wesela z 14-dniową karencją i możliwością cofnięcia
- [x] `audit_log` dla wszystkich operacji moderacji i usuwania
- **Gotowe, gdy:** po twardym usunięciu nie da się pobrać pliku z żadnego wcześniej wystawionego adresu (po wygaśnięciu jego ważności). Spełnione konstrukcyjnie: bucket prywatny, adresy podpisane na 10 min (filmy Stream: token 1 h).

### Etap 9: Cykl życia i retencja

- [x] Zadania cykliczne workera: `active` -> `read_only` -> `archived` -> `pending_deletion` -> `deleted`
- [x] Generowanie ZIP strumieniowo do R2, mail do pary z podpisanym linkiem
- [x] Przypomnienia przed usunięciem (3 dni przed)
- **Gotowe, gdy:** test z przyspieszonym zegarem przechodzi przez wszystkie stany wesela, a ZIP zawiera zdjęcia i wideo. Spełnione (`apps/worker/src/jobs/*.test.ts`).

### Etap 10: Bezpieczeństwo i RODO

- [x] Przegląd autoryzacji każdego endpointu, limity żądań, CSP, `pnpm audit`
- [x] Strony regulaminu i polityki prywatności, obsługa żądań usunięcia danych
- [~] Przegląd bezpieczeństwa `/cso`: wykonany przegląd ręczny (wyniki niżej); formalne `/cso` zalecane przed produkcją
- **Gotowe, gdy:** brak znalezisk o wysokiej ważności, a testy autoryzacji pokrywają wszystkie endpointy.

Wyniki przeglądu ręcznego:

- Poprawione: brak kontroli `Origin` na endpointach gościa zmieniających stan (login CSRF), brak limitu równoległych strumieni SSE na sesję, błąd parsowania webhooka dawał 500.
- Zaakceptowane: rozmiar uploadu do R2 sprawdzany po wysłaniu (R2 nie wspiera `content-length-range`), limit logowania Better Auth w pamięci maszyny, `esbuild` (moderate) tylko w narzędziu deweloperskim.
- Brak znalezisk o wysokiej ważności.

### Etap 11: Obciążenie i wdrożenie

- [x] Konfiguracja Fly.io (`fly.toml` dla web i worker, Dockerfile), endpoint `/api/health`
- [ ] Staging i produkcja: Neon, bucket R2, Stream, domena, Sentry, kopie zapasowe bazy (wymaga Twoich kont; instrukcja w `docs/runbook.md`)
- [~] Test k6: 200 gości w 5 minut na jednym weselu i 20 wesel równolegle (skrypt `load/k6-wedding.js` gotowy, uruchomienie na stagingu)
- [x] Runbook na wypadek awarii w sobotę wieczorem (`docs/runbook.md`)
- **Gotowe, gdy:** na stagingu przechodzą testy E2E, a test obciążeniowy mieści się w progach (p95 API < 500 ms, brak zgubionych uploadów).

## Odstępstwa od planu (z uzasadnieniem)

- **Nazwy tabel:** `tenants` / `tenant_members` zamiast `accounts` / `account_members`, bo Better Auth zajmuje nazwę `account` na konta logowania.
- **`plan_limits` jako kod** (`packages/core/src/plans.ts`) zamiast tabeli: dwa plany bez płatności nie uzasadniają tabeli; przejście na tabelę razem ze Stripe.
- **PIN szyfrowany (AES-256-GCM), nie hashowany:** para musi móc zobaczyć i wydrukować PIN w panelu. Klucz `PIN_ENCRYPTION_KEY` tylko w sekretach serwera.
- **Wideo bez TUS:** podstawowy direct upload Stream (do 200 MB) pokrywa limit planu (200 MB, 60 s) prościej; TUS warto dodać przy dłuższych filmach.
- **HEIC przez `heic-convert`:** gotowe binaria `sharp` nie mają dekodera HEVC (licencje), dekodowanie w czystym JS.
- **Testy bazy na PGlite** zamiast Postgresa w Dockerze: `pnpm test` działa bez Dockera; E2E w CI używa prawdziwego Postgresa.
- **Mailpit** w `docker-compose` do przechwytywania e-maili lokalnie i w E2E.
- **Pakiet `packages/services`:** konfiguracja, storage, Stream i e-mail współdzielone przez web i worker.
- **Worker uruchamiany przez `tsx`** zamiast bundla: omija problemy z bundlowaniem `sharp`, koszt tylko przy starcie procesu.
- **Wariant `full` (4096 px, bez EXIF):** źródło do pobierania i ZIP, bo oryginał z GPS jest kasowany po przetworzeniu.

## Poza MVP (tylko uwzględnione w architekturze)

- Płatności i plany (Stripe).
- Moduł propozycji piosenek dla DJ-a i głosowanie na utwory.
- Pokaz slajdów na żywo na rzutnik.
- Automatyczna moderacja przez AI, własne domeny, wersja angielska, aplikacja mobilna.

## Ograniczenia środowiska lokalnego

- Brak Dockera na tej maszynie: testy E2E nie były uruchamiane lokalnie (uruchomią się w CI lub po instalacji Docker Desktop: `docker compose up -d && pnpm db:migrate && pnpm build && pnpm test:e2e`).
- Plik `.env` wygenerowany z losowymi sekretami do pracy lokalnej.
- Kroki wymagające kont zewnętrznych (Fly.io, Neon, Cloudflare R2/Stream, Resend, Sentry) są przygotowane w kodzie i konfiguracji; uruchomienie wymaga Twoich danych dostępowych.
