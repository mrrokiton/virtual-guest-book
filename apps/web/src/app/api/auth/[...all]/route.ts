import { toNextJsHandler } from 'better-auth/next-js';
import { auth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export function GET(req: Request) {
  return toNextJsHandler(auth()).GET(req);
}

export function POST(req: Request) {
  return toNextJsHandler(auth()).POST(req);
}
