import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Regulamin' };

export default function TermsPage() {
  return (
    <>
      <h1>Regulamin</h1>
      <p className="text-muted-foreground">Wersja z 26 września 2026 r.</p>

      <h2>1. Czym jest usługa</h2>
      <p>
        Wirtualna księga gości pozwala Parze Młodej utworzyć prywatną galerię wesela, do której
        goście dodają zdjęcia i krótkie filmy po zeskanowaniu kodu QR i podaniu PIN-u. Goście nie
        zakładają konta.
      </p>

      <h2>2. Role</h2>
      <ul>
        <li>
          Organizator (Para Młoda i zaproszeni współadministratorzy) zakłada wesele, zarządza
          dostępem i moderuje galerię.
        </li>
        <li>
          Gość to osoba, która zna link i PIN wesela. Widzi galerię i może dodawać pliki w okresie
          ustalonym przez organizatora.
        </li>
      </ul>

      <h2>3. Zasady dodawania treści</h2>
      <ul>
        <li>
          Dodawaj tylko zdjęcia i filmy, które sam(a) wykonałeś(-aś) lub do których masz prawa.
        </li>
        <li>
          Nie dodawaj treści niezgodnych z prawem, obraźliwych ani naruszających prywatność innych
          osób.
        </li>
        <li>
          Dodane pliki widzą wszyscy goście wesela i organizator. Organizator może je ukryć lub
          usunąć.
        </li>
        <li>
          Dodając plik, udzielasz organizatorowi nieodpłatnej licencji na jego przechowywanie,
          wyświetlanie gościom i pobranie na własny, prywatny użytek.
        </li>
      </ul>

      <h2>4. Usuwanie</h2>
      <ul>
        <li>Gość może usunąć pliki dodane ze swojego urządzenia, dopóki galeria jest dostępna.</li>
        <li>
          Organizator może w każdej chwili usunąć dowolny plik lub całe wesele (z 14-dniowym okresem
          na cofnięcie decyzji).
        </li>
        <li>
          Po upływie okresu przechowywania galeria jest automatycznie zamykana, a następnie trwale
          usuwana wraz ze wszystkimi plikami. Organizator otrzymuje wcześniej paczkę ZIP.
        </li>
      </ul>

      <h2>5. Odpowiedzialność</h2>
      <p>
        Dokładamy starań, aby usługa działała nieprzerwanie, ale nie gwarantujemy jej dostępności w
        każdej chwili. Zalecamy pobranie paczki ZIP, gdy tylko będzie dostępna.
      </p>

      <h2>6. Kontakt i zgłoszenia</h2>
      <p>
        Naruszenia regulaminu i nielegalne treści zgłaszaj na adres podany w polityce prywatności.
        Możemy zablokować wesele, które narusza regulamin.
      </p>
    </>
  );
}
