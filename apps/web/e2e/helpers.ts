import { expect, type Browser, type Page } from '@playwright/test';
import { Client } from 'pg';

const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8025';

export function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@e2e.test`;
}

/** Polls Mailpit for the newest message to `to` and returns the first link in it. */
export async function linkFromMail(to: string, subjectIncludes: string): Promise<string> {
  for (let i = 0; i < 40; i++) {
    const search = await fetch(
      `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`,
    );
    const { messages } = (await search.json()) as { messages: { ID: string; Subject: string }[] };
    const msg = messages.find((m) => m.Subject.includes(subjectIncludes));
    if (msg) {
      const full = (await (await fetch(`${MAILPIT}/api/v1/message/${msg.ID}`)).json()) as {
        Text: string;
      };
      const link = full.Text.match(/https?:\/\/\S+/)?.[0];
      if (link) return link;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No "${subjectIncludes}" e-mail for ${to}`);
}

export async function registerAdmin(page: Page, name = 'Ania i Tomek'): Promise<string> {
  const email = uniqueEmail('admin');
  await page.goto('/register');
  await page.getByLabel('Imiona pary').fill(name);
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Hasło').fill('bardzo-tajne-haslo-123');
  await page.getByRole('button', { name: 'Załóż konto' }).click();
  await expect(page.getByRole('heading', { name: 'Sprawdź skrzynkę' })).toBeVisible();
  await page.goto(await linkFromMail(email, 'Potwierdź adres'));
  await expect(page).toHaveURL(/\/dashboard/);
  return email;
}

function todayInWarsaw(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw' }).format(new Date());
}

/** Stands in for the platform admin clicking "Zatwierdź" in /admin. */
async function approveWedding(id: string): Promise<void> {
  const client = new Client({
    connectionString: process.env.DATABASE_URL ?? 'postgres://vgb:vgb@localhost:5432/vgb',
  });
  await client.connect();
  try {
    await client.query('update weddings set approved_at = now() where id = $1', [id]);
  } finally {
    await client.end();
  }
}

export interface WeddingInfo {
  id: string;
  guestUrl: string;
  pin: string;
}

export async function createActiveWedding(page: Page, name: string): Promise<WeddingInfo> {
  await page.goto('/dashboard');
  await page.getByLabel('Nazwa').fill(name);
  await page.getByLabel('Data wesela').fill(todayInWarsaw());
  await page.getByRole('button', { name: 'Utwórz wesele' }).click();
  await expect(page).toHaveURL(/\/dashboard\/weddings\/[0-9a-f-]{36}$/);
  const id = page.url().split('/').pop()!;
  await approveWedding(id);
  await page.reload();
  await page.getByRole('button', { name: 'Aktywuj wesele' }).click();
  await expect(page.getByText('Aktywne', { exact: true })).toBeVisible();
  const guestUrl = (await page.getByTestId('guest-url').textContent())!.trim();
  const pin = (await page.getByTestId('wedding-pin').textContent())!.trim();
  return { id, guestUrl, pin };
}

export async function joinAsGuest(
  browser: Browser,
  wedding: WeddingInfo,
  name: string,
): Promise<Page> {
  const context = await browser.newContext({ locale: 'pl-PL' });
  const page = await context.newPage();
  await page.goto(wedding.guestUrl);
  await page.getByLabel('PIN').fill(wedding.pin);
  await page.getByLabel('Twoje imię (opcjonalnie)').fill(name);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Wejdź do galerii' }).click();
  await expect(page.getByRole('button', { name: 'Dodaj zdjęcia lub filmy' })).toBeVisible();
  return page;
}
