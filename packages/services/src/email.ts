import nodemailer, { type Transporter } from 'nodemailer';
import type { ServerConfig } from './config';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  send(message: EmailMessage): Promise<void>;
}

class ResendMailer implements Mailer {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async send(m: EmailMessage): Promise<void> {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: this.from,
        to: [m.to],
        subject: m.subject,
        text: m.text,
        html: m.html,
      }),
    });
    if (!res.ok) throw new Error(`Resend failed with ${res.status}: ${await res.text()}`);
  }
}

class SmtpMailer implements Mailer {
  private readonly transport: Transporter;

  constructor(
    url: string,
    private readonly from: string,
  ) {
    this.transport = nodemailer.createTransport(url);
  }

  async send(m: EmailMessage): Promise<void> {
    await this.transport.sendMail({ from: this.from, ...m });
  }
}

class ConsoleMailer implements Mailer {
  async send(m: EmailMessage): Promise<void> {
    console.info(`[email] to=${m.to} subject="${m.subject}"\n${m.text}`);
  }
}

export function createMailer(cfg: ServerConfig): Mailer {
  if (cfg.RESEND_API_KEY) return new ResendMailer(cfg.RESEND_API_KEY, cfg.EMAIL_FROM);
  if (cfg.SMTP_URL) return new SmtpMailer(cfg.SMTP_URL, cfg.EMAIL_FROM);
  return new ConsoleMailer();
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

function layout(
  title: string,
  paragraphs: string[],
  action?: { label: string; url: string },
): EmailMessage['html'] {
  const body = paragraphs.map((p) => `<p style="margin:0 0 16px">${escapeHtml(p)}</p>`).join('');
  const button = action
    ? `<p style="margin:24px 0"><a href="${escapeHtml(action.url)}" style="background:#7c4d3a;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block">${escapeHtml(action.label)}</a></p>`
    : '';
  return `<!doctype html><html><body style="font-family:system-ui,sans-serif;color:#2b2320;max-width:560px;margin:0 auto;padding:24px"><h1 style="font-size:20px">${escapeHtml(title)}</h1>${body}${button}<p style="color:#8a7b74;font-size:12px">Wirtualna księga gości</p></body></html>`;
}

function message(
  to: string,
  subject: string,
  paragraphs: string[],
  action?: { label: string; url: string },
): EmailMessage {
  const text = [...paragraphs, action ? `${action.label}: ${action.url}` : '']
    .filter(Boolean)
    .join('\n\n');
  return { to, subject, text, html: layout(subject, paragraphs, action) };
}

const fmtDate = (d: Date) =>
  d.toLocaleDateString('pl-PL', { day: 'numeric', month: 'long', year: 'numeric' });

export const emails = {
  verifyEmail: (to: string, url: string) =>
    message(
      to,
      'Potwierdź adres e-mail',
      ['Dziękujemy za rejestrację. Potwierdź adres e-mail, aby zalogować się do panelu.'],
      {
        label: 'Potwierdź adres',
        url,
      },
    ),

  resetPassword: (to: string, url: string) =>
    message(
      to,
      'Reset hasła',
      ['Otrzymaliśmy prośbę o zmianę hasła. Jeśli to nie Ty, zignoruj tę wiadomość.'],
      {
        label: 'Ustaw nowe hasło',
        url,
      },
    ),

  magicLink: (to: string, url: string) =>
    message(
      to,
      'Link do logowania',
      ['Kliknij, aby zalogować się do panelu. Link wygasa za 10 minut.'],
      {
        label: 'Zaloguj się',
        url,
      },
    ),

  invite: (to: string, p: { weddingName: string; inviterName: string; url: string }) =>
    message(
      to,
      `Zaproszenie do współprowadzenia: ${p.weddingName}`,
      [
        `${p.inviterName} zaprasza Cię do pomocy w prowadzeniu galerii wesela „${p.weddingName}”. Zaproszenie jest ważne 7 dni.`,
      ],
      { label: 'Przyjmij zaproszenie', url: p.url },
    ),

  exportReady: (to: string, p: { weddingName: string; url: string; availableUntil: Date }) =>
    message(
      to,
      `Paczka zdjęć gotowa: ${p.weddingName}`,
      [
        `Przygotowaliśmy paczkę ZIP ze wszystkimi zdjęciami i filmami z wesela „${p.weddingName}”.`,
        `Pobierz ją z panelu. Będzie dostępna do ${fmtDate(p.availableUntil)}.`,
      ],
      { label: 'Przejdź do pobierania', url: p.url },
    ),

  deletionScheduled: (
    to: string,
    p: { weddingName: string; purgeAt: Date; url: string; automatic: boolean },
  ) =>
    message(
      to,
      `Galeria zostanie usunięta: ${p.weddingName}`,
      [
        p.automatic
          ? `Okres przechowywania galerii wesela „${p.weddingName}” dobiegł końca.`
          : `Zlecono usunięcie wesela „${p.weddingName}”.`,
        `Wszystkie zdjęcia i filmy zostaną trwale usunięte ${fmtDate(p.purgeAt)}. Do tego czasu możesz pobrać paczkę ZIP lub cofnąć usunięcie w panelu.`,
      ],
      { label: 'Otwórz panel', url: p.url },
    ),

  deletionReminder: (to: string, p: { weddingName: string; purgeAt: Date; url: string }) =>
    message(
      to,
      `Przypomnienie: galeria zniknie ${fmtDate(p.purgeAt)}`,
      [
        `Za kilka dni trwale usuniemy wszystkie zdjęcia i filmy z wesela „${p.weddingName}”.`,
        'Jeśli jeszcze nie pobrałeś(-aś) paczki ZIP, zrób to teraz. Po usunięciu nie da się ich odzyskać.',
      ],
      { label: 'Pobierz paczkę ZIP', url: p.url },
    ),
};
