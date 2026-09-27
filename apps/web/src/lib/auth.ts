import { ensureTenantForUser, schema } from '@vgb/db';
import { emails } from '@vgb/services';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';
import { magicLink } from 'better-auth/plugins/magic-link';
import { env } from './env';
import { db, mailer } from './server';

function createAuth() {
  const cfg = env();
  return betterAuth({
    appName: 'Wirtualna księga gości',
    baseURL: cfg.APP_URL,
    secret: cfg.BETTER_AUTH_SECRET,
    trustedOrigins: [cfg.APP_URL],
    database: drizzleAdapter(db(), {
      provider: 'pg',
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
      },
    }),
    session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 10,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        await mailer().send(emails.resetPassword(user.email, url));
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        await mailer().send(emails.verifyEmail(user.email, url));
      },
    },
    rateLimit: { enabled: cfg.NODE_ENV === 'production', window: 60, max: 30 },
    plugins: [
      magicLink({
        disableSignUp: true,
        expiresIn: 10 * 60,
        sendMagicLink: async ({ email, url }) => {
          await mailer().send(emails.magicLink(email, url));
        },
      }),
      nextCookies(),
    ],
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            await ensureTenantForUser(db(), user.id, user.name);
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;

const g = globalThis as typeof globalThis & { __vgbAuth?: Auth };

export function auth(): Auth {
  return (g.__vgbAuth ??= createAuth());
}
