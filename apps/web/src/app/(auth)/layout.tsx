import Link from 'next/link';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-12">
      <Link href="/" className="mb-8 text-sm uppercase tracking-[0.2em] text-accent">
        Wirtualna księga gości
      </Link>
      {children}
    </main>
  );
}
