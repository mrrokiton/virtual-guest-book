import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Polityka prywatności' };

export default function PrivacyPage() {
  return (
    <>
      <h1>Polityka prywatności</h1>
      <p className="text-muted-foreground">Wersja z 26 września 2026 r.</p>

      <h2>Administrator i podmiot przetwarzający</h2>
      <p>
        Za zdjęcia i filmy w galerii wesela odpowiada organizator wesela (administrator danych).
        Operator serwisu przetwarza je w jego imieniu wyłącznie w celu świadczenia usługi. Dane kont
        organizatorów przetwarza operator jako administrator.
      </p>

      <h2>Jakie dane zbieramy</h2>
      <ul>
        <li>Organizatorzy: adres e-mail, imię, hasło (przechowywane jako skrót), dane wesela.</li>
        <li>
          Goście: opcjonalne imię podane przy wejściu, anonimowy identyfikator sesji w ciasteczku
          oraz dodane zdjęcia i filmy. Nie wymagamy adresu e-mail.
        </li>
        <li>
          Dane techniczne: skrót adresu IP (do ochrony przed zgadywaniem PIN-u), logi błędów. Nie
          używamy ciasteczek reklamowych ani analitycznych.
        </li>
      </ul>

      <h2>Metadane zdjęć</h2>
      <p>
        Zdjęcia są pomniejszane w przeglądarce i ponownie przetwarzane na serwerze. Usuwamy z nich
        metadane EXIF, w tym lokalizację GPS. Oryginalny plik jest kasowany po przetworzeniu.
      </p>

      <h2>Jak długo przechowujemy dane</h2>
      <ul>
        <li>
          Galeria jest dostępna dla gości przez okres wynikający z planu, potem zostaje zamknięta.
        </li>
        <li>
          Po okresie archiwum i 14-dniowej karencji wszystkie pliki i dane gości są trwale usuwane.
        </li>
        <li>
          Usunięty plik jest kasowany z serwera w ciągu kilku minut; wcześniej wydane linki wygasają
          najpóźniej po godzinie.
        </li>
        <li>Kopie zapasowe bazy danych są nadpisywane w ciągu 30 dni.</li>
      </ul>

      <h2>Odbiorcy danych</h2>
      <p>
        Korzystamy z dostawców infrastruktury: hosting aplikacji i bazy danych (Fly.io),
        przechowywanie plików (Cloudflare R2), przetwarzanie wideo (Cloudflare Stream) oraz wysyłka
        e-maili. Dane są przechowywane w regionach UE, o ile dostawca to umożliwia.
      </p>

      <h2>Twoje prawa</h2>
      <p>
        Masz prawo dostępu do danych, ich sprostowania, usunięcia, ograniczenia przetwarzania i
        przenoszenia oraz prawo skargi do Prezesa UODO. Gość może sam usunąć swoje pliki w galerii
        albo poprosić o to organizatora wesela. Jeśli chcesz usunąć plik dodany z innego urządzenia,
        napisz do organizatora lub do nas.
      </p>

      <h2>Kontakt</h2>
      <p>
        W sprawach danych osobowych i zgłoszeń naruszeń:{' '}
        <span className="font-mono">privacy@example.com</span> (adres do uzupełnienia przed
        uruchomieniem produkcyjnym).
      </p>
    </>
  );
}
