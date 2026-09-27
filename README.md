# Wirtualna księga gości weselnych

Goście skanują kod QR, podają PIN i dodają zdjęcia oraz krótkie filmy bez zakładania konta. Wszyscy
oglądają wspólną galerię aktualizowaną na żywo. Para Młoda zarządza weselem w panelu: kod QR do
druku, moderacja, współadministratorzy, paczka ZIP. Po okresie przechowywania dane są automatycznie
usuwane.

## Struktura

| Katalog             | Zawartość                                                                  |
| ------------------- | -------------------------------------------------------------------------- |
| `apps/web`          | Next.js: strefa gościa `/w/[slug]`, panel `/dashboard`, API, SSE, webhooki |
| `apps/worker`       | pg-boss: miniatury (sharp, HEIC), ZIP, cykl życia wesel, twarde usuwanie   |
| `packages/core`     | Reguły domenowe: stany wesela, uprawnienia, limity planów, PIN, typy zadań |
| `packages/db`       | Schemat Drizzle, migracje, dostęp do danych ograniczony do jednego wesela  |
| `packages/services` | Konfiguracja (Zod), storage S3/R2, Cloudflare Stream, e-mail               |
| `docs/runbook.md`   | Wdrożenie, konfiguracja usług, postępowanie przy awariach                  |

## Uruchomienie lokalne

Wymagania: Node 22+, pnpm 12, Docker.

```sh
pnpm install
cp .env.example .env        # uzupełnij sekrety (instrukcja w pliku)
docker compose up -d        # Postgres, MinIO (S3), Mailpit (e-maile: http://localhost:8025)
pnpm db:migrate
pnpm dev                    # web: http://localhost:3000 + worker
```

Konto superadmina: `pnpm --filter @vgb/web create-superadmin <email> <hasło>`.

## Kontrola jakości

```sh
pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm test:e2e               # wymaga docker compose i zbudowanej aplikacji
```

Testy bazy działają na PGlite (Postgres w procesie), więc `pnpm test` nie potrzebuje Dockera.
