import { PrintButton } from '@/components/print-button';
import { qrSvg } from '@/lib/qr';
import { requireWeddingAccess } from '@/lib/session';
import { formatDate } from '@/lib/utils';
import { formatPin, guestUrl, weddingPin } from '@/lib/weddings';

export default async function PrintCardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { wedding } = await requireWeddingAccess(id, 'wedding.view');
  const svg = await qrSvg(guestUrl(wedding.slug));
  const pin = formatPin(weddingPin(wedding));

  return (
    <div>
      <div className="no-print mb-6 flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Wydrukuj kartę i postaw na stołach lub przy wejściu.
        </p>
        <PrintButton />
      </div>
      <div className="mx-auto max-w-md rounded-lg border border-border bg-white p-10 text-center shadow-sm print:border-0 print:shadow-none">
        <p className="text-sm uppercase tracking-[0.25em] text-accent">Podziel się zdjęciami</p>
        <h1 className="mt-3 text-3xl font-semibold">{wedding.theme.headline || wedding.name}</h1>
        <p className="mt-1 text-muted-foreground">{formatDate(wedding.eventDate)}</p>
        <div className="mx-auto my-8 w-64" dangerouslySetInnerHTML={{ __html: svg }} />
        <p className="text-sm text-muted-foreground">PIN</p>
        <p className="font-mono text-4xl tracking-[0.3em]">{pin}</p>
        <ol className="mt-8 space-y-1 text-left text-sm text-muted-foreground">
          <li>1. Zeskanuj kod aparatem w telefonie.</li>
          <li>2. Wpisz PIN.</li>
          <li>3. Dodawaj zdjęcia i oglądaj zdjęcia innych gości.</li>
        </ol>
      </div>
    </div>
  );
}
