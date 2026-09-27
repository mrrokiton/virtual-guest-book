import { qrPng } from '@/lib/qr';
import { checkWeddingAccess } from '@/lib/session';
import { guestUrl } from '@/lib/weddings';

export const dynamic = 'force-dynamic';

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await checkWeddingAccess((await params).id, 'wedding.view');
  if (!access) return new Response('Not found', { status: 404 });
  const png = await qrPng(guestUrl(access.wedding.slug));
  return new Response(new Uint8Array(png), {
    headers: {
      'Content-Type': 'image/png',
      'Content-Disposition': 'attachment; filename="kod-qr-wesela.png"',
      'Cache-Control': 'private, no-store',
    },
  });
}
