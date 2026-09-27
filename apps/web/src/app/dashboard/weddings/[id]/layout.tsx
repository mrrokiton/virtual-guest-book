import Link from 'next/link';
import { Badge } from '@/components/ui/card';
import { requireWeddingAccess } from '@/lib/session';
import { formatDate } from '@/lib/utils';
import { STATUS_LABELS, STATUS_TONES } from '@/lib/weddings';

export default async function WeddingLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { wedding, role } = await requireWeddingAccess(id, 'wedding.view');
  const base = `/dashboard/weddings/${wedding.id}`;
  const tabs = [
    { href: base, label: 'Przegląd' },
    { href: `${base}/media`, label: 'Zdjęcia i filmy' },
    { href: `${base}/settings`, label: 'Ustawienia' },
    { href: `${base}/team`, label: 'Zespół' },
  ];

  return (
    <div>
      <div className="no-print mb-6">
        <Link href="/dashboard" className="text-sm text-muted-foreground hover:underline">
          ← Moje wesela
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{wedding.name}</h1>
          <Badge tone={STATUS_TONES[wedding.status]}>{STATUS_LABELS[wedding.status]}</Badge>
          {wedding.blockedAt ? <Badge tone="danger">Zablokowane</Badge> : null}
        </div>
        <p className="text-sm text-muted-foreground">
          {formatDate(wedding.eventDate)} · {role === 'owner' ? 'właściciel' : 'współadministrator'}
        </p>
        <nav className="mt-4 flex gap-1 overflow-x-auto border-b border-border text-sm">
          {tabs.map((t) => (
            <Link
              key={t.href}
              href={t.href}
              className="whitespace-nowrap rounded-t-lg px-3 py-2 hover:bg-muted"
            >
              {t.label}
            </Link>
          ))}
        </nav>
      </div>
      {children}
    </div>
  );
}
