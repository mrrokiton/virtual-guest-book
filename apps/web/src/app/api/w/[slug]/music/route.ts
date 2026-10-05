import {
  canCreateMusicSuggestion,
  DomainError,
  guestCanUpload,
  isMusicKind,
  MUSIC_CREATE_LIMIT,
  MUSIC_CREATE_WINDOW_MS,
  MUSIC_SAFETY_CAP,
  musicBodyError,
  musicCreateCap,
  normalizeMusicBody,
} from '@vgb/core';
import { hitRateLimit, publishMusicChanged, weddingScope } from '@vgb/db';
import { z } from 'zod';
import { resolveGuest } from '@/lib/guest';
import { loadMusicModule, toMusicEntry } from '@/lib/music';
import { crossOriginResponse, domainErrorResponse, jsonError, readJson } from '@/lib/request';
import { db } from '@/lib/server';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  kind: z.string(),
  body: z.string(),
});

async function context(slug: string) {
  const guest = await resolveGuest(slug);
  if (!guest) return null;
  const music = await loadMusicModule(guest.wedding.id);
  if (!music) return { disabled: true as const };
  return { disabled: false as const, guest, ...music, scope: weddingScope(db(), guest.wedding.id) };
}

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const ctx = await context((await params).slug);
    if (!ctx) return jsonError(401, 'Brak dostępu.');
    if (ctx.disabled) return jsonError(404, 'Propozycje muzyczne są wyłączone.');
    const sessionId = ctx.guest.session.id;
    const capInput = await ctx.scope.music.durableCapInput(sessionId);
    const [open, history] = await Promise.all([
      ctx.scope.music.listOpen(),
      ctx.scope.music.listHistory(),
    ]);
    return Response.json(
      {
        open: open.map((row) => toMusicEntry(row, sessionId)),
        history: history.map((row) => toMusicEntry(row, sessionId)),
        capRemaining: Math.max(0, musicCreateCap(capInput) - capInput.mine),
        atSafetyCap: capInput.mine >= MUSIC_SAFETY_CAP,
        isDj: ctx.guest.session.role === 'dj',
        canMutate: guestCanUpload(ctx.guest.wedding, new Date()),
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (err) {
    return domainErrorResponse(err);
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const forbidden = crossOriginResponse(req);
  if (forbidden) return forbidden;
  try {
    const ctx = await context((await params).slug);
    if (!ctx) return jsonError(401, 'Sesja wygasła. Podaj PIN ponownie.');
    if (ctx.disabled) return jsonError(404, 'Propozycje muzyczne są wyłączone.');
    if (!guestCanUpload(ctx.guest.wedding, new Date())) {
      return jsonError(409, 'Dodawanie propozycji jest już zamknięte.');
    }

    const parsed = bodySchema.safeParse(await readJson(req));
    if (!parsed.success || !isMusicKind(parsed.data.kind)) {
      return jsonError(400, 'Nieprawidłowe dane.');
    }
    const problem = musicBodyError(parsed.data.body);
    if (problem) return jsonError(400, problem);
    const body = parsed.data.body.trim();
    const bodyKey = normalizeMusicBody(body);
    const session = ctx.guest.session;

    const rate = await hitRateLimit(db(), `music:${session.id}`, MUSIC_CREATE_WINDOW_MS);
    if (rate.count > MUSIC_CREATE_LIMIT) {
      throw new DomainError(
        'rate_limited',
        'Wysyłasz propozycje zbyt szybko. Odczekaj kilka minut.',
      );
    }
    if (await ctx.scope.music.hasActiveDuplicate(session.id, parsed.data.kind, bodyKey)) {
      throw new DomainError('invalid_input', 'Ta propozycja jest już na Twojej liście.');
    }

    const capInput = await ctx.scope.music.durableCapInput(session.id);
    if (!canCreateMusicSuggestion(capInput)) {
      const cap = musicCreateCap(capInput);
      const message =
        cap >= 40
          ? 'Osiągnięto limit 40 propozycji na to urządzenie.'
          : 'Lista jest teraz pełniejsza od Twojej strony. Limit wzrośnie, gdy inni goście też coś zgłoszą.';
      throw new DomainError('limit_exceeded', message);
    }

    const created = await ctx.scope.music.create({
      guestSessionId: session.id,
      authorName: session.displayName,
      kind: parsed.data.kind,
      body,
      bodyKey,
      fairQueue: ctx.fairQueue,
    });
    await ctx.scope.audit({
      actorType: 'guest',
      actorId: session.id,
      action: 'music.created',
      targetType: 'music_suggestion',
      targetId: created.id,
      metadata: { kind: created.kind },
    });
    await publishMusicChanged(db(), ctx.guest.wedding.id);
    return Response.json(toMusicEntry(created, session.id), { status: 201 });
  } catch (err) {
    return domainErrorResponse(err);
  }
}
