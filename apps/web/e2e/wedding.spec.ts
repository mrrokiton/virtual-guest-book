import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { createActiveWedding, joinAsGuest, registerAdmin, type WeddingInfo } from './helpers';

const PHOTO = fileURLToPath(new URL('./fixtures/photo.jpg', import.meta.url));

test.describe.serial('wedding from registration to moderation', () => {
  let admin: Page;
  let wedding: WeddingInfo;
  let uploader: Page;
  let viewer: Page;

  test.beforeAll(async ({ browser }) => {
    admin = await (await browser.newContext()).newPage();
    await registerAdmin(admin);
    wedding = await createActiveWedding(admin, 'Wesele E2E');
  });

  test('guest page is private: noindex and no data without a PIN', async ({ request }) => {
    const res = await request.get(wedding.guestUrl);
    expect(res.headers()['x-robots-tag']).toContain('noindex');
    expect(res.headers()['content-security-policy']).toContain("frame-ancestors 'none'");

    const slug = new URL(wedding.guestUrl).pathname.split('/').pop();
    expect((await request.get(`/api/w/${slug}/media`)).status()).toBe(401);
    expect(
      (
        await request.post(`/api/w/${slug}/uploads`, {
          data: { contentType: 'image/jpeg', size: 10 },
        })
      ).status(),
    ).toBe(401);
    expect((await request.get(`/api/w/${slug}/events`)).status()).toBe(401);
    expect((await request.get('/w/aaaaaaaaaaaaaaaaaaaaaaaa')).status()).toBe(404);
  });

  test('wrong PIN is rejected with a helpful message', async ({ browser }) => {
    const page = await (await browser.newContext()).newPage();
    await page.goto(wedding.guestUrl);
    await page.getByLabel('PIN').fill('ZZZZZZ');
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Wejdź do galerii' }).click();
    await expect(page.getByRole('alert')).toContainText('Nieprawidłowy PIN');
  });

  test('guest uploads a photo and another guest sees it live @mobile', async ({ browser }) => {
    uploader = await joinAsGuest(browser, wedding, 'Ciocia Zosia');
    viewer = await joinAsGuest(browser, wedding, 'Wujek Staszek');
    await expect(viewer.getByText('Jeszcze nic tu nie ma')).toBeVisible();

    await uploader.locator('input[type=file][multiple]').setInputFiles(PHOTO);
    await expect(uploader.getByText(/Wysłano 1 z 1/)).toBeVisible();

    // Delivered over SSE once the worker has processed it; the viewer never reloads.
    await expect(viewer.getByRole('button', { name: 'Otwórz zdjęcie' })).toHaveCount(1, {
      timeout: 45_000,
    });
  });

  test('served photos have EXIF and GPS stripped', async () => {
    await viewer.getByRole('button', { name: 'Otwórz zdjęcie' }).click();
    await expect(viewer.getByText('Dodał(a): Ciocia Zosia')).toBeVisible();
    const href = await viewer
      .getByRole('link', { name: 'Pobierz w pełnej jakości' })
      .getAttribute('href');
    const res = await viewer.request.get(href!);
    expect(res.ok()).toBe(true);
    const body = await res.body();
    expect(body.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
    expect(body.includes(Buffer.from('E2EPhone'))).toBe(false);
    await viewer.getByRole('button', { name: 'Zamknij' }).click();
  });

  test('couple hides a photo and it disappears for guests in real time', async () => {
    await admin.goto(`/dashboard/weddings/${wedding.id}/media`);
    await admin.locator('ul li button').first().click();
    await admin.getByRole('button', { name: 'Ukryj' }).click();
    await expect(admin.getByText('Ukryto: 1.')).toBeVisible();
    await expect(viewer.getByRole('button', { name: 'Otwórz zdjęcie' })).toHaveCount(0);

    await admin.locator('ul li button').first().click();
    await admin.getByRole('button', { name: 'Przywróć' }).click();
    await expect(viewer.getByRole('button', { name: 'Otwórz zdjęcie' })).toHaveCount(1);
  });

  test('guest can delete only their own photo', async () => {
    await viewer.getByRole('button', { name: 'Otwórz zdjęcie' }).click();
    await expect(viewer.getByRole('button', { name: 'Usuń moje zdjęcie' })).toHaveCount(0);
    await viewer.getByRole('button', { name: 'Zamknij' }).click();

    await uploader.reload();
    await uploader.getByRole('button', { name: 'Otwórz zdjęcie' }).click();
    await uploader.getByRole('button', { name: 'Usuń moje zdjęcie' }).click();
    await uploader.getByRole('button', { name: 'Usuń na pewno' }).click();
    await expect(viewer.getByRole('button', { name: 'Otwórz zdjęcie' })).toHaveCount(0);
  });

  test('another couple cannot open this wedding', async ({ browser }) => {
    const stranger = await (await browser.newContext()).newPage();
    await registerAdmin(stranger, 'Obcy');
    const res = await stranger.goto(`/dashboard/weddings/${wedding.id}`);
    expect(res?.status()).toBe(404);
    expect((await stranger.request.get(`/api/admin/weddings/${wedding.id}/qr`)).status()).toBe(404);
  });

  // Last: it locks this IP out of the wedding's PIN form for 15 minutes.
  test('PIN guessing is rate limited', async ({ request }) => {
    const slug = new URL(wedding.guestUrl).pathname.split('/').pop();
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const res = await request.post(`/api/w/${slug}/session`, {
        data: { pin: `WRONG${i}`, acceptTerms: true },
      });
      statuses.push(res.status());
    }
    expect(statuses.slice(0, 9).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(9)).toEqual([429, 429]);
  });
});
