import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';

export default function LandingPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center px-6 py-16">
      <p className="mb-3 text-sm uppercase tracking-[0.2em] text-accent">Wirtualna księga gości</p>
      <h1 className="mb-6 text-4xl font-semibold sm:text-5xl">
        Wszystkie zdjęcia z Waszego wesela w jednym miejscu
      </h1>
      <p className="mb-10 max-w-xl text-lg text-muted-foreground">
        Goście skanują kod QR i od razu dodają zdjęcia oraz krótkie filmy ze swoich telefonów. Bez
        aplikacji i bez zakładania kont. Po weselu dostajecie komplet w jednej paczce.
      </p>
      <div className="flex flex-wrap gap-3">
        <Link href="/register" className={buttonVariants({ size: 'lg' })}>
          Załóż księgę gości
        </Link>
        <Link href="/login" className={buttonVariants({ size: 'lg', variant: 'outline' })}>
          Zaloguj się
        </Link>
      </div>
      <footer className="mt-24 flex gap-4 text-sm text-muted-foreground">
        <Link href="/regulamin">Regulamin</Link>
        <Link href="/prywatnosc">Polityka prywatności</Link>
      </footer>
    </main>
  );
}
