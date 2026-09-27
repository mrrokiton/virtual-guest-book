import Link from 'next/link';

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <Link href="/" className="text-sm text-muted-foreground hover:underline">
        ← Strona główna
      </Link>
      <article className="mt-6 space-y-4 text-sm leading-relaxed [&_h1]:font-serif [&_h1]:text-3xl [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc">
        {children}
      </article>
    </main>
  );
}
