# Propozycje muzyczne dla DJ-a

Status: ZATWIERDZONY i zaimplementowany (05.10.2026).
Branch: `feature/music-suggestions` (od `main`, bez commitów).

`tasks/todo.md` zostaje planem MVP. Ten plik jest planem tej funkcji.

Legenda: `[ ]` do zrobienia, `[~]` w toku, `[x]` gotowe, `[-]` pominięte (z uzasadnieniem).

## Ustalenia

- DJ wchodzi linkiem z panelu pary. Link tworzy sesję gościa z rolą `dj`. Bez konta Better Auth i bez panelu. Wiele linków oznacza wielu DJ-ów.
- DJ ma wszystko, co gość (galeria, upload, własne propozycje), plus zmianę statusu propozycji.
- Statusy: `open`, `played`, `skipped`. DJ może każdy z nich cofnąć do innego. W kolejce są tylko `open`. Zagrane i pominięte widać w historii na tym samym ekranie.
- Imię autora widzą wszyscy, jeśli gość podał je przy wejściu. Brak imienia wyświetla się jako „Gość”. Identyfikator sesji nie wychodzi do przeglądarki.
- Dodawanie, usuwanie i zmiana statusu tylko wtedy, gdy wesele jest `active` i `now < readOnlyAt` (`guestCanUpload`). To samo okno co upload zdjęć.
- Odczyt listy także w `read_only` (`guestCanView`), bez przycisków zmian. Po `archived` gość i DJ tracą dostęp razem z galerią. Usunięcie wesela kasuje propozycje kaskadą.
- Panel pary tylko włącza moduł i kolejkowanie oraz wystawia linki DJ-a. Nie ma tam listy utworów. Uprawnienie: istniejące `wedding.edit` (owner i co_admin, tak jak ustawienia). Nowych uprawnień panelu nie dodajemy.
- Rotacja PIN-u z „wyloguj wszystkich gości” wylogowuje też DJ-a, bo to ta sama tabela sesji. Link DJ-a dalej działa i zakłada nową sesję. Bez wyjątku w `revokeAll`.

## Rozszerzenia, nie nowe mechanizmy

- Flaga funkcji: istniejąca tabela `wedding_modules`, klucz `music_requests`. Brak wiersza oznacza wyłączone (`isEnabled` już tak działa). `config.fairQueue: boolean`, domyślnie `false`.
- Rola DJ-a: kolumna na `guest_sessions`, nie nowa rola w `wedding_members`.
- Limity liczby prób: istniejące `rate_limits`.
- Reguły liczby i kolejki: czyste funkcje w `@vgb/core`, tak jak plany i stany wesela.
- Zapytania: `weddingScope`, tak jak media. Aplikacje nie importują `drizzle-orm`.
- Błędy: `DomainError` i kody HTTP już zmapowane w `apps/web/src/lib/request.ts`.

## Model danych

Migracja Drizzle w `packages/db/drizzle`.

`guest_sessions`

- `role` text not null default `'guest'` (`guest` | `dj`)
- `dj_link_id` uuid null, FK do linku, `on delete set null`

`wedding_dj_links`

- `id` uuid PK
- `wedding_id` FK cascade
- `token_hash` text unique (SHA-256, jak zaproszenia współadministratora)
- `label` text null (nazwa w panelu pary, niewidoczna dla gości)
- `created_by_user_id` FK `set null`
- `revoked_at`, `created_at`

`music_suggestions`

- `id` uuid PK
- `wedding_id` FK cascade
- `guest_session_id` FK `set null` (propozycja zostaje, gdy sesja wygaśnie)
- `author_name` text null (kopia imienia z chwili zgłoszenia, żeby historia nie zmieniała się po zmianie imienia sesji)
- `kind` text `track` | `genre`
- `body` text not null, 1–120 znaków po trim
- `status` text not null default `open`
- `queue_rank` integer null (kolejność `open`; przy zejściu z kolejki zostaje, żeby cofnięcie wróciło na stare miejsce)
- `details` jsonb not null default `{}` (później artysta, identyfikator utworu; API na razie ignoruje obce klucze)
- `created_at` timestamptz precision 3
- `status_changed_at` timestamptz null
- `deleted_at` timestamptz null

Indeks: `(wedding_id, deleted_at, status, queue_rank)`.

## Antyspam

Egzekwowane w core, wołane z endpointu tworzenia. Licznik **trwały** sesji: `open` + `played` + `skipped` + miękko usunięte. Usunięcie nie zwalnia miejsca. Zagranie i pominięcie też nie.

Stałe: minimum 3, zapas +2 ponad średnią, sufit 40 na sesję.

```
participants = sesje z trwałym licznikiem > 0
jeśli wołający ma 0: participants += 1
cap = min(40, max(3, floor(totalDurable / participants) + 2))
wolno, gdy mine < cap
```

Dodatkowo, niezależnie od udziału: 8 utworzeń na 10 minut na sesję (`rate_limits`, klucz `music:<sessionId>`). Oraz odrzucenie duplikatu tej samej sesji: ten sam `kind` i ten sam tekst po trim, lower-case i ściśnięciu spacji, wśród wierszy z `deleted_at is null`.

Komunikat, gdy brak miejsca: ile jeszcze można dodać (0) i że limit rośnie, gdy inni też zgłaszają. Przy samym suficie: „Osiągnięto limit 40 propozycji na to urządzenie.”

Przykłady (`mine < cap`):

| Sytuacja                | cap                  | Kto może dodać                                                                     |
| ----------------------- | -------------------- | ---------------------------------------------------------------------------------- |
| Pusta lista             | 3                    | pierwsza osoba, do 3                                                               |
| Tylko A ma 3            | 5                    | A może dojść do 5, potem cap rośnie o 2, aż do 40                                  |
| A ma 10, B ma 0         | 7 dla B, 12 dla A    | B może zacząć. A nadal jest jedynym autorem, więc jego limit jeszcze rośnie        |
| A i B mają po 10        | 12                   | oboje, do 12. Nikt nie blokuje drugiego na zawsze                                  |
| A ma 10, B ma 1, C ma 0 | 5 dla C, 7 dla A i B | C może zacząć. A (10) stoi, bo jest wyraźnie powyżej średniej. B (1) może dokładać |

Samotny gość nie staje na 3. Sufit 40 jest tylko hamulcem nadużycia.

## Kolejkowanie

Ustawienie `fairQueue` na module. Przełączenie nie kasuje wierszy, tylko przelicza `queue_rank` wierszy `open` w tej samej transakcji.

Wyłączone: `open` według `created_at`, potem `id`. Cofnięcie wraca na miejsce według czasu utworzenia.

Włączone. Odczyt to `order by queue_rank, id`. Odświeżenie strony nic nie liczy od nowa.

Zamrożona głowa: **3**. Przy 3 lub mniej otwartych pozycjach ogon jest pusty, więc kolejność jest zwykłą kolejnością zgłoszeń.

Wynik punktowy ogona, rosnąco (mniejszy wynik jest wyżej):

1. liczba **otwartych** propozycji autora (włącznie z nową),
2. liczba jego **zagranych i pominiętych** (nieusuniętych),
3. `created_at`,
4. `id`.

Miękko usunięte liczą się tylko do antyspamu, nie do punktów. Literówka nie spycha reszty utworów tej osoby.

Zasady zapisu rankingu:

- Nowe zgłoszenie nie wchodzi do głowy. Głowa to pierwsze 3 według dotychczasowego `queue_rank`. Nowy element wstawia się w ogon według punktów.
- Oznaczenie `played` lub `skipped` oraz usunięcie: wiersz wypada z listy `open`, ale zostawia `queue_rank`. Reszta się nie przestawia.
- Cofnięcie do `open`: wraca na zapisany `queue_rank` (także do głowy, jeśli tam był). To korekta pomyłki DJ-a, nie nowe zgłoszenie.
- Włączenie fair queue na istniejącej liście: zamroź pierwsze 3 w obecnej kolejności, ogon przelicz raz.
- Wyłączenie: ułóż wszystkie `open` po `created_at`, `id`.

Osoba z jedną otwartą propozycją jest w grupie „1 otwarta”, nawet jeśli wcześniej dużo zgłosiła. Nie ląduje za wszystkimi swoimi starymi utworami, bo te są już poza kolejką. Wiele otwartych sztuk tej samej osoby idzie niżej niż pojedyncze sztuki innych.

### Przykłady

Fair queue włączone. A i B. Puste.

1. A dodaje A1, A2, A3. Jest co najwyżej 3 pozycje, więc kolejka to `[A1, A2, A3]`.
2. A dodaje A4. Głowa `[A1, A2, A3]`, ogon `[A4]`.
3. B dodaje B1. Głowa bez zmian. W ogonie B1 ma 1 otwartą, A4 ma 4. Wynik: `[A1, A2, A3, B1, A4]`.
4. B dodaje B2. Ogon: B1 i B2 mają po 2 otwarte, A4 ma 4. Remis B rozstrzyga czas: `[A1, A2, A3, B1, B2, A4]`.
5. DJ oznacza A1 jako zagrane. A1 schodzi do historii. Reszta zostaje: `[A2, A3, B1, B2, A4]`. Odświeżenie nic nie rusza.
6. DJ cofa A1. A1 wraca na swój stary rank, na początek: `[A1, A2, A3, B1, B2, A4]`.
7. A usuwa A4. Znika z kolejki i nie poprawia punktów pozostałych. Licznik antyspamu A nadal obejmuje A4.

Mała lista: jeden gość, dwa utwory, fair queue włączone. Kolejność równa się kolejności dodania. Nic się nie przetasowuje.

## API i UI

Gość i DJ, ciasteczko sesji, `crossOriginResponse` na mutacjach, `weddingScope`.

| Metoda                                 | Kto                         | Kiedy                                                                                                                                   |
| -------------------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/w/[slug]/music`              | gość lub DJ, `guestCanView` | moduł włączony. `{ open, history, capRemaining }`. Każda pozycja: `id`, `kind`, `body`, `status`, `authorName`, `mine`, `createdAt`     |
| `POST /api/w/[slug]/music`             | gość lub DJ                 | `guestCanUpload`, antyspam, rate limit. Body `{ kind, body }`                                                                           |
| `DELETE /api/w/[slug]/music/[id]`      | autor wiersza               | `guestCanUpload`, miękkie usunięcie                                                                                                     |
| `POST /api/w/[slug]/music/[id]/status` | tylko `dj`                  | `guestCanUpload`. Body `{ status: open \| played \| skipped }`                                                                          |
| `POST /api/w/[slug]/dj`                | publiczne jak PIN           | Body `{ token, displayName?, acceptTerms: true }`. Hash tokenu, link nieodwołany, wesele `guestCanView`. Tworzy sesję `dj` i ciasteczko |

Moduł wyłączony: 404, bez listy. Cudzy wiersz przy usuwaniu: 404. Status od zwykłego gościa: 403. Zamknięte okno uploadu: 409.

Panel, server actions, `checkWeddingAccess(..., 'wedding.edit')`:

- `setMusicModuleAction` (`enabled`, `fairQueue`)
- `createDjLinkAction` (zwraca URL raz; w bazie tylko hash)
- `revokeDjLinkAction` (unieważnia link i sesje z `dj_link_id`)

UI:

- Ustawienia wesela: sekcja „Propozycje muzyczne”. Przełączniki i lista linków. Bez listy utworów.
- Wejście DJ-a: `/w/[slug]/dj/[token]`, formularz imienia i regulaminu, ten sam układ co PIN.
- `GuestApp`: blok propozycji, gdy moduł włączony. Typ utwór/gatunek, pole tekstu, lista, usuwanie własnych. DJ widzi „Zagrane”, „Pomiń”, „Cofnij”. W `read_only` lista bez formularza i bez tych przycisków.

Audyt: `music.created`, `music.deleted`, `music.status`, `music.module`, `dj_link.created`, `dj_link.revoked`.

## Etapy

### 1. Reguły w `@vgb/core`

- [x] Typy `MusicKind`, `MusicStatus`, `GuestSessionRole`, stałe limitów i długości tekstu.
- [x] `musicCreateCap` i `canCreateMusicSuggestion` z testami przykładów z tabeli wyżej, w tym usuniętych i sufitu 40.
- [x] `rankOpenSuggestions` z testami przykładów 1–7, listy krótszej niż 3, wyłączenia fair queue i cofnięcia na stary rank.
- [x] Gotowe, gdy `pnpm --filter @vgb/core test` przechodzi i żaden test nie wymaga bazy.

### 2. Schemat i dostęp do danych

- [x] Migracja kolumn i tabel z sekcji „Model danych”.
- [x] `weddingScope`: lista, tworzenie, miękkie usunięcie własne, zmiana statusu, liczniki trwałe per sesja, zapis rankingu w transakcji.
- [x] Linki DJ: tworzenie hasha, odczyt po hashu, odwołanie, sesje powiązane.
- [x] Test PGlite: propozycja wesela A nie jest widoczna w zakresie B. Usunięcie własne nie rusza cudzego wiersza.
- [x] Gotowe, gdy `pnpm --filter @vgb/db test` przechodzi, a `pnpm db:generate` nie zostawia niezaaplikowanego diffa schematu.

### 3. API gościa i DJ-a

- [x] Endpointy z tabeli, walidacja Zod, `DomainError`, brak `sessionId` w JSON.
- [x] Wejście DJ-a: limit prób na token (wzorzec PIN, osobny klucz), `acceptTerms`, ciasteczko przez `setGuestCookie`.
- [x] Moduł wyłączony daje 404. Zwykły gość nie zmienia statusu.
- [x] Gotowe, gdy ręczne wywołania na lokalnym serwerze pokrywają: utworzenie, odmowę ponad cap, usunięcie cudzej, status DJ-a, 404 przy wyłączonym module.

### 4. Panel pary

- [x] Sekcja w ustawieniach wesela. Akcje z `wedding.edit`.
- [x] URL linku pokazywany po utworzeniu. Odwołanie linku unieważnia sesje DJ-a tego linku.
- [x] Włączenie i wyłączenie `fairQueue` nie kasuje propozycji.
- [x] Gotowe, gdy owner i co_admin ustawiają moduł, a użytkownik bez `wedding.edit` dostaje odmowę.

### 5. Strefa gościa

- [x] Formularz i listy w `GuestApp`, spójne z istniejącymi komponentami.
- [x] Autor widoczny dla wszystkich. Przyciski statusu tylko przy sesji `dj`. Usuwanie tylko przy `mine` i otwartym oknie.
- [x] `read_only`: lista bez mutacji.
- [x] Gotowe, gdy dwa konteksty przeglądarki widzą tę samą kolejność po zgłoszeniu, a odświeżenie jej nie zmienia.

### 6. Testy regresji i mapa

- [x] Istniejące `pnpm test` bez nowych zależności od modułu (domyślnie wyłączony).
- [x] Jeden scenariusz Playwright: włączenie modułu, zgłoszenie gościa, drugi gość widzi imię i nie usuwa cudzej, DJ oznacza „Zagrane”. Dotychczasowy `wedding.spec.ts` bez zmian zachowania.
- [x] Aktualizacja `PROJECT_MAP.md`: schemat, API, rola DJ-a, przepływ propozycji, ograniczenia. `AGENTS.md` bez zmian, jeśli instrukcja czytania mapy zostaje.
- [x] Gotowe, gdy `pnpm lint && pnpm typecheck && pnpm test` przechodzi. E2E, jeśli Docker jest dostępny.

Poza zakresem: płatności, głosowanie na utwory, pokaz slajdów, moderacja AI, lista propozycji w panelu pary, osobne okno czasu inne niż `guestCanUpload`.
