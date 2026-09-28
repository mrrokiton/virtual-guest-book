# Runbook: Wirtualna księga gości

Dla osoby, która w sobotę o 22:00 dostaje telefon „goście nie mogą dodać zdjęć”. Najpierw sekcja
[Awarie](#awarie), konfiguracja od zera na końcu.

## Architektura w jednym akapicie

`vgb-web` (Next.js na Fly.io, region `fra`) obsługuje gości, panel i API. Pliki trafiają z telefonu
prosto do Cloudflare R2 (podpisany PUT), filmy do Cloudflare Stream. `vgb-worker` (pg-boss) robi
miniatury, ZIP-y, cykl życia wesel i twarde usuwanie. Wspólny Postgres (Neon, Frankfurt) trzyma dane
i kolejkę zadań. Galeria odświeża się przez SSE zasilane `LISTEN/NOTIFY`; gdy SSE nie działa,
przeglądarka sama przechodzi na odpytywanie co 10 s.

## Szybka diagnoza

| Sprawdź               | Jak                                                                                                             |
| --------------------- | --------------------------------------------------------------------------------------------------------------- |
| Czy web żyje          | `curl https://<domena>/api/health` → `{"ok":true}`; `fly status -a vgb-web`                                     |
| Logi web              | `fly logs -a vgb-web`                                                                                           |
| Czy worker przetwarza | `fly logs -a vgb-worker` → linie `[job] photo … ok in …ms`                                                      |
| Kolejka zadań         | SQL poniżej                                                                                                     |
| Błędy aplikacji       | Sentry (projekt web i worker)                                                                                   |
| Status dostawców      | [Fly](https://status.flyio.net), [Cloudflare](https://www.cloudflarestatus.com), [Neon](https://neonstatus.com) |

```sql
-- Zaległe i nieudane zadania z ostatniej godziny
select name, state, count(*) from pgboss.job
where created_on > now() - interval '1 hour' group by 1, 2 order by 1, 2;

-- Pliki utknięte w przetwarzaniu dla konkretnego wesela
select status, count(*) from media where wedding_id = '<id>' group by 1;
```

## Awarie

### Goście nie mogą wejść (PIN)

1. Czy wesele jest `active` lub `read_only` i niezablokowane: panel superadmina `/admin`.
2. `429` w logach oznacza limit prób: 10 błędnych prób na urządzenie (potem blokada na 15 minut
   od ostatniej próby) lub 300 na wesele w 15 minut. Osobno: 100 nowych wejść z jednego IP na
   wesele w 15 minut (goście na wspólnym Wi-Fi sali dzielą IP). Limit mija sam. W nagłym wypadku:
   `delete from rate_limits where key like 'pin:%<wedding_id>%';`
3. PIN wyciekł lub trafił na publiczny profil: para zmienia PIN w Ustawieniach, z opcją
   „wyloguj wszystkich gości”. Stare sesje przestają działać od razu.

### Zdjęcia się nie wysyłają

- Błąd CORS w konsoli przeglądarki: sprawdź regułę CORS bucketu R2 (sekcja Konfiguracja). Musi
  zezwalać na `PUT` z domeny aplikacji z nagłówkiem `Content-Type`.
- „Galeria osiągnęła limit plików”: limit planu. Na teraz: zmiana planu wesela w SQL
  (`update weddings set plan = 'premium' where id = '<id>';`).
- Upload przechodzi, ale zdjęcie nie pojawia się w galerii: worker. Sprawdź `fly logs -a vgb-worker`.
  Jeśli maszyna nie działa: `fly machine start -a vgb-worker`. Zadania nie giną: pg-boss podejmie je
  po restarcie. Pliki `uploading` starsze niż 24 h (gość nie dokończył wysyłki) są oznaczane jako
  nieudane i sprzątane. Pliki `processing` starsze niż godzina są ponawiane co przebieg cyklu życia:
  zdjęcia wracają do kolejki, a stan filmów jest pobierany z Stream.

### Galeria nie odświeża się na żywo

Bez paniki: klient po 3 nieudanych połączeniach SSE przechodzi na odpytywanie co 10 s (w nagłówku
pojawia się „Tryb oszczędny”). Jeśli dotyczy wszystkich: zrestartuj web (`fly apps restart vgb-web`).
Hub SSE po utracie połączenia z Postgresem łączy się ponownie i wysyła klientom `resync`.

### Filmy nie działają

Filmy przetwarza Cloudflare Stream i zgłasza gotowość webhookiem `POST /api/webhooks/stream`.
Sprawdź w panelu Cloudflare → Stream → Webhooks, czy wywołania nie kończą się `401` (zły
`CLOUDFLARE_STREAM_WEBHOOK_SECRET`). Filmy bez webhooka worker po godzinie sprawdza bezpośrednio w
API Stream i oznacza jako gotowe albo nieudane.

### Baza danych niedostępna

Web zwraca `503` na `/api/health`, Fly przestaje kierować ruch. Neon: sprawdź status i limity
połączeń. Po powrocie bazy nic nie trzeba robić ręcznie.

## Zadania operacyjne

- **Superadmin:** obraz web nie zawiera `tsx`, więc skrypt uruchamia się lokalnie z produkcyjnymi
  zmiennymi środowiskowymi: `pnpm --filter @vgb/web create-superadmin <email> [hasło]`.
- **Zablokowanie wesela** (nielegalne treści): `/admin` → Zablokuj. Goście tracą dostęp od razu, para
  widzi komunikat. Superadmin celowo nie ma wglądu w zdjęcia.
- **Żądanie usunięcia danych od gościa:** gość sam usuwa swoje pliki w galerii. Jeśli nie może
  (inne urządzenie), para usuwa je w zakładce „Zdjęcia i filmy”. W ostateczności superadmin w SQL:
  `update media set status = 'deleted', deleted_at = now() where id = '<id>';`. Worker skasuje pliki
  w ciągu godziny (zadanie sprzątające w `lifecycle-tick`).
- **Przywrócenie wesela** w okresie karencji (14 dni): para klika „Anuluj usunięcie” w panelu. Po
  terminie `purge_at` danych nie da się odzyskać.
- **Ręczne uruchomienie cyklu życia:** restart workera (`fly apps restart vgb-worker`); przy starcie
  wysyła tick, potem co 10 minut.

## Wdrożenie

Zawsze najpierw worker (uruchamia migracje jako `release_command`), potem web:

```sh
fly deploy . --config apps/worker/fly.toml --dockerfile apps/worker/Dockerfile
fly deploy . --config apps/web/fly.toml --dockerfile apps/web/Dockerfile
```

Wycofanie: `fly releases -a vgb-web`, potem `fly deploy --image <poprzedni obraz>`. Migracje są
tylko dodające, więc poprzednia wersja działa na nowym schemacie.

## Konfiguracja od zera

1. **Postgres (Neon, region Frankfurt).** Użyj połączenia bez PgBouncera (pooler w trybie transakcji
   psuje `LISTEN/NOTIFY` i pg-boss). Włącz point-in-time restore (kopie zapasowe).
2. **Cloudflare R2.** Bucket prywatny (bez publicznego dostępu), token API z uprawnieniem Object
   Read & Write do tego bucketu. Reguła CORS:
   ```json
   [
     {
       "AllowedOrigins": ["https://<domena>"],
       "AllowedMethods": ["PUT", "GET"],
       "AllowedHeaders": ["Content-Type"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```
3. **Cloudflare Stream.** Token API (Stream:Edit), klucz podpisujący
   (`POST /accounts/<id>/stream/keys`, zapisz `id` i `pem`), webhook na
   `https://<domena>/api/webhooks/stream` (zapisz sekret).
4. **Resend.** Zweryfikuj domenę nadawcy, klucz API.
5. **Sentry.** Dwa projekty (web, worker) albo jeden; DSN do sekretów.
6. **Fly.io.**
   ```sh
   fly apps create vgb-web && fly apps create vgb-worker
   fly secrets set -a vgb-web  APP_URL=https://<domena> DATABASE_URL=... BETTER_AUTH_SECRET=... \
     GUEST_SESSION_SECRET=... PIN_ENCRYPTION_KEY=... S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com \
     S3_BUCKET=... S3_ACCESS_KEY_ID=... S3_SECRET_ACCESS_KEY=... CLOUDFLARE_ACCOUNT_ID=... \
     CLOUDFLARE_STREAM_API_TOKEN=... CLOUDFLARE_STREAM_CUSTOMER_CODE=... CLOUDFLARE_STREAM_WEBHOOK_SECRET=... \
     CLOUDFLARE_STREAM_SIGNING_KEY_ID=... CLOUDFLARE_STREAM_SIGNING_KEY_PEM=... EMAIL_FROM=... RESEND_API_KEY=... SENTRY_DSN=...
   # worker: te same sekrety
   fly certs add <domena> -a vgb-web
   ```
   `PIN_ENCRYPTION_KEY` musi być identyczny w web i worker i **nie może się zmienić**: bez niego PIN-y
   istniejących wesel są nie do odczytania.
7. **Test obciążeniowy na stagingu:** `k6 run -e BASE_URL=... -e WEDDINGS="slug:PIN,..." load/k6-wedding.js`
   (20 wesel na planie premium). Progi: p95 API < 500 ms, brak zgubionych uploadów.

## Znane ograniczenia

- Limit rozmiaru uploadu do R2 jest sprawdzany po wysłaniu (R2 nie obsługuje polityk POST z
  `content-length-range`): za duże pliki są kasowane przy potwierdzeniu, porzucone po 24 h.
- Limit strumieni SSE (300 na wesele, 4 na sesję gościa) jest liczony w pamięci każdej maszyny web.
  Goście ponad limit przechodzą na odpytywanie co 10 s.
- `pnpm audit`: jedno znalezisko średniej wagi w `esbuild` (zależność `drizzle-kit`), dotyczy tylko
  serwera deweloperskiego esbuild, nieużywanego w produkcji.
