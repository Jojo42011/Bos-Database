import { test, expect } from '@playwright/test';
import path from 'node:path';
test('desktop, mobile and a real authenticated import workflow', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your crowd, understood.' })).toBeVisible();
  await expect(page.getByText('186', { exact: true })).toBeVisible();
  await page.screenshot({
    path: process.env.CC_SCREENSHOTS
      ? path.join(process.env.CC_SCREENSHOTS, 'crowd-control-desktop.png')
      : 'test-results/desktop.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByRole('button', { name: 'Audience', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search audience' }).fill('guest10@');
  await expect(page.getByText('guest10@example.com', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Jasmine/ }).click();
  await expect(page.getByRole('heading', { name: 'Purchase history' })).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'Events', exact: true }).click();
  await page.getByRole('button', { name: /After Hours/ }).click();
  await expect(page.getByText('The right people for this night.')).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your crowd, understood.' })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  await expect(page.locator('.sidebar')).toHaveCSS('transform', 'matrix(1, 0, 0, 1, -238, 0)');
  await page.screenshot({
    path: process.env.CC_SCREENSHOTS
      ? path.join(process.env.CC_SCREENSHOTS, 'crowd-control-mobile.png')
      : 'test-results/mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.getByRole('button', { name: 'Set up your workspace' }).click();
  await page.getByLabel('Email address').fill('qa@example.com');
  await page.getByLabel('Password', { exact: true }).fill('test-owner-password-123');
  await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await expect(page.getByText('Live workspace', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Create event', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Event name').fill('E2E Velvet Night');
  await dialog.getByLabel('Concept / series').fill('Velvet');
  await dialog.getByLabel('Genre', { exact: true }).fill('R&B');
  await dialog.getByLabel('City', { exact: true }).fill('Austin');
  await dialog.getByLabel('Venue', { exact: true }).fill('The Room');
  await dialog.getByLabel('Start date').fill('2027-10-10T21:00:00-05:00');
  await dialog.getByLabel('Capacity').fill('250');
  await dialog.getByLabel('Base ticket price').fill('30');
  await dialog.getByRole('button', { name: 'Create event', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'E2E Velvet Night' })).toBeVisible();
  await page.getByRole('button', { name: 'Import audience', exact: true }).click();
  await page.getByLabel('Which event').selectOption({ label: 'E2E Velvet Night · Austin' });
  await page
    .locator('input[type=file]')
    .setInputFiles({
      name: 'qa-orders.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(
        'order_id,name,email,quantity,subtotal,refund,purchased_at,city\nqa-001,Test Guest,test@example.com,2,60.00,0.00,2026-09-18T20:00:00-05:00,Austin\n',
      ),
    });
  await page.getByRole('button', { name: 'Preview import' }).click();
  await expect(page.getByRole('heading', { name: 'Review your import.' })).toBeVisible();
  await page.getByRole('button', { name: 'Import 1 orders' }).click();
  await expect(page.getByText('Import complete. Your audience has been updated.')).toBeVisible();
  await page.getByRole('button', { name: 'Audience', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search audience' }).fill('test@example.com');
  await page.getByRole('button', { name: /Test Guest/ }).click();
  await expect(page.getByRole('dialog').getByText('$60', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Record consent' }).click();
  await page.getByLabel('Decision').selectOption('opted_in');
  await page
    .getByLabel('Evidence / source')
    .fill('QA preference form v1 explicitly accepted by guest');
  await page.getByRole('button', { name: 'Save consent evidence' }).click();
  await expect(page.getByText('Email · opted in')).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.reload();
  await page.getByRole('button', { name: /Crowd Control Demo workspace/ }).click();
  await expect(page.getByText('Live workspace', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Audience', exact: true }).click();
  await expect(page.getByText('test@example.com', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
