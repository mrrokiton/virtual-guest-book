# Agent instructions

Read `PROJECT_MAP.md` before starting any task. It is the primary reference for architecture, directory layout, dependencies, API, database schema, and conventions.

If `PROJECT_MAP.md` disagrees with the code, update the map before changing behavior. After a change that affects architecture, directories, the API, the database schema, or a major flow, update only the sections that changed.

Do not invent files, endpoints, or schema. Distinguish implemented behavior from items marked planned in the map.

Product context and the local runbook live in `README.md`, `docs/runbook.md`, and `tasks/todo.md`. Those files do not replace `PROJECT_MAP.md`.

App queries go through `@vgb/db` (`weddingScope` for one wedding). Do not import `drizzle-orm` from `apps/`. Domain rules belong in `@vgb/core`. Shared storage, video, email, and env parsing belong in `@vgb/services`.

User-facing copy is Polish. Do not commit `.env` or live secrets.
