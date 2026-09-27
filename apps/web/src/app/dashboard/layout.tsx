import { isPlatformAdmin } from '@vgb/db';
import type { Metadata } from 'next';
import Link from 'next/link';
import { SignOutButton } from '@/components/sign-out-button';
import { requireUser } from '@/lib/session';
import { db } from '@/lib/server';

export const metadata: Metadata = { title: 'Panel', robots: { index: false } };

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const platformAdmin = await isPlatformAdmin(db(), user.id);
  return (
    <div className="min-h-dvh">
      <header className="no-print border-b border-border bg-card">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <Link href="/dashboard" className="font-serif text-lg">
            Księga gości
          </Link>
          <nav className="flex items-center gap-2 text-sm">
            {platformAdmin ? (
              <Link href="/admin" className="rounded-lg px-3 py-1.5 hover:bg-muted">
                Platforma
              </Link>
            ) : null}
            <span className="hidden text-muted-foreground sm:inline">{user.email}</span>
            <SignOutButton />
          </nav>
        </div>
      </header>
      <div className="mx-auto max-w-5xl px-4 py-8">{children}</div>
    </div>
  );
}
