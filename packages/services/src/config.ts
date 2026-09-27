import { z } from 'zod';

const optional = z
  .string()
  .optional()
  .transform((v) => (v === '' ? undefined : v));

const base64Key32 = z
  .string()
  .refine((v) => Buffer.from(v, 'base64').length === 32, 'must be 32 random bytes, base64-encoded');

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_URL: z.url(),
    DATABASE_URL: z.string().min(1),
    BETTER_AUTH_SECRET: z.string().min(32),
    GUEST_SESSION_SECRET: z.string().min(32),
    PIN_ENCRYPTION_KEY: base64Key32,

    S3_ENDPOINT: z.url(),
    S3_PUBLIC_ENDPOINT: optional,
    S3_REGION: z.string().default('auto'),
    S3_BUCKET: z.string().min(1),
    S3_ACCESS_KEY_ID: z.string().min(1),
    S3_SECRET_ACCESS_KEY: z.string().min(1),
    S3_FORCE_PATH_STYLE: z.stringbool().default(false),

    VIDEO_PROVIDER: z.enum(['local', 'cloudflare']).default('local'),
    CLOUDFLARE_ACCOUNT_ID: optional,
    CLOUDFLARE_STREAM_API_TOKEN: optional,
    CLOUDFLARE_STREAM_CUSTOMER_CODE: optional,
    CLOUDFLARE_STREAM_WEBHOOK_SECRET: optional,
    CLOUDFLARE_STREAM_SIGNING_KEY_ID: optional,
    CLOUDFLARE_STREAM_SIGNING_KEY_PEM: optional,

    EMAIL_FROM: z.string().default('Księga gości <no-reply@localhost>'),
    RESEND_API_KEY: optional,
    SMTP_URL: optional,

    SENTRY_DSN: optional,
  })
  .superRefine((env, ctx) => {
    if (env.VIDEO_PROVIDER !== 'cloudflare') return;
    for (const key of [
      'CLOUDFLARE_ACCOUNT_ID',
      'CLOUDFLARE_STREAM_API_TOKEN',
      'CLOUDFLARE_STREAM_CUSTOMER_CODE',
      'CLOUDFLARE_STREAM_WEBHOOK_SECRET',
      'CLOUDFLARE_STREAM_SIGNING_KEY_ID',
      'CLOUDFLARE_STREAM_SIGNING_KEY_PEM',
    ] as const) {
      if (!env[key])
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: 'required when VIDEO_PROVIDER=cloudflare',
        });
    }
  });

export type ServerConfig = z.infer<typeof schema>;

export function parseServerConfig(env: Record<string, string | undefined>): ServerConfig {
  const result = schema.safeParse(env);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}
