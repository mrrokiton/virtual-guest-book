import * as Sentry from '@sentry/nextjs';

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.SENTRY_DSN) {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV,
      tracesSampleRate: 0,
    });
  }
  // `next build` loads this file. Starting the worker then would need the production database.
  if (process.env.NEXT_PHASE === 'phase-production-build') return;
  const { startWorkerKeepalive } = await import('@/lib/worker-keepalive');
  startWorkerKeepalive();
}

export const onRequestError = Sentry.captureRequestError;
