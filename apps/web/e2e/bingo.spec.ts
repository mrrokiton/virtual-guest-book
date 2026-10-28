import { expect, test } from '@playwright/test';
import { createActiveWedding, joinAsGuest, registerAdmin } from './helpers';

test('organizer configures Bingo and verifies a guest photo @mobile', async ({ browser }) => {
  const admin = await (await browser.newContext()).newPage();
  await registerAdmin(admin, 'Para Bingo');
  const wedding = await createActiveWedding(admin, 'Wesele z Bingo');

  await admin.goto(`/dashboard/weddings/${wedding.id}/bingo/settings`);
  await admin.getByPlaceholder('Dodaj nowe zadanie').fill('Zrób zdjęcie z parą młodą');
  await admin.getByRole('button', { name: 'Dodaj', exact: true }).click();
  await expect(admin.getByText('Zadanie dodane.')).toBeVisible();
  await admin.getByLabel('Imię i nazwisko').fill('Anna Nowak');
  await admin.getByLabel('Ksywka (opcjonalnie)').fill('Ania');
  await admin.getByRole('button', { name: 'Dodaj osobę' }).click();
  await expect(admin.getByText('Osoba dodana.')).toBeVisible();
  await admin.getByRole('button', { name: 'Włącz Bingo' }).click();
  await expect(admin.getByText('Bingo jest aktywne.')).toBeVisible();

  const guest = await joinAsGuest(browser, wedding, 'Ola');
  await guest.getByRole('link', { name: 'Bingo' }).click();
  await expect(guest.getByText('Zrób zdjęcie z parą młodą')).toBeVisible();
  await guest.locator('input[type=file]').setInputFiles('e2e/fixtures/photo.jpg');
  await expect(guest.getByText('Oczekuje na weryfikację')).toBeVisible({ timeout: 30_000 });
  await expect(guest.getByText('Anna Nowak „Ania”')).toBeVisible();

  await admin.goto(`/dashboard/weddings/${wedding.id}/bingo`);
  await expect(admin.getByText('Zrób zdjęcie z parą młodą')).toBeVisible();
  await admin.getByRole('button', { name: 'Akceptuj' }).click();
  await expect(admin.getByText('Zdjęcie zaakceptowane.')).toBeVisible();
  await expect(guest.getByText('Bingo ukończone!')).toBeVisible({ timeout: 15_000 });
});
