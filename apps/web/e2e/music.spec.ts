import { expect, test } from '@playwright/test';
import { createActiveWedding, joinAsGuest, registerAdmin } from './helpers';

test('guests suggest songs and the DJ marks one as played', async ({ browser }) => {
  const admin = await (await browser.newContext()).newPage();
  await registerAdmin(admin, 'Para Muzyczna');
  const wedding = await createActiveWedding(admin, 'Wesele z DJ-em');

  await admin.goto(`/dashboard/weddings/${wedding.id}/settings`);
  await admin.getByRole('checkbox', { name: 'Włącz propozycje na stronie gościa' }).check();
  await admin.getByRole('button', { name: 'Zapisz propozycje' }).click();
  await expect(admin.getByText('Propozycje muzyczne są włączone.')).toBeVisible();

  await admin.getByLabel('Nazwa (tylko dla Was)').fill('DJ Marek');
  await admin.getByRole('button', { name: 'Utwórz link' }).click();
  const alert = admin.getByRole('alert');
  await expect(alert).toContainText('/dj/');
  const djUrl = (await alert.textContent())!.match(/https?:\/\/\S+/)![0]!;

  const jan = await joinAsGuest(browser, wedding, 'Wujek Jan');
  await jan.getByRole('link', { name: 'Utwory' }).click();
  await expect(jan.getByText('Nikt jeszcze nic nie zgłosił.')).toBeVisible();

  const zosia = await joinAsGuest(browser, wedding, 'Ciocia Zosia');
  await zosia.getByRole('link', { name: 'Utwory' }).click();
  await zosia.getByLabel('Utwór').fill('Dancing Queen');
  await zosia.getByRole('button', { name: 'Dodaj propozycję' }).click();
  await expect(zosia.getByText('Dancing Queen')).toBeVisible();
  await expect(zosia.getByRole('button', { name: 'Usuń' })).toBeVisible();

  await expect(jan.getByText('Dancing Queen')).toBeVisible({ timeout: 15_000 });
  await expect(jan.getByText('Ciocia Zosia')).toBeVisible();
  await expect(jan.getByRole('button', { name: 'Usuń' })).toHaveCount(0);

  await jan.getByRole('link', { name: 'Zdjęcia' }).click();
  await expect(jan.getByLabel('Utwór')).toHaveCount(0);
  await expect(jan.getByRole('button', { name: 'Dodaj propozycję' })).toHaveCount(0);

  const dj = await (await browser.newContext()).newPage();
  await dj.goto(djUrl);
  await dj.getByLabel('Twoje imię (opcjonalnie)').fill('DJ Marek');
  await dj.getByRole('checkbox').check();
  await dj.getByRole('button', { name: 'Wejdź jako DJ' }).click();
  await dj.getByRole('link', { name: 'Utwory' }).click();
  await dj.getByRole('button', { name: 'Zagrane' }).click();
  await expect(dj.getByRole('heading', { name: 'Historia' })).toBeVisible();
  await expect(dj.getByText('Zagrane · Ciocia Zosia')).toBeVisible();
  await expect(dj.getByRole('button', { name: 'Zagrane' })).toHaveCount(0);
});
