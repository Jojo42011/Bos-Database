import { test, expect } from '@playwright/test';
import path from 'node:path';
test('open access, mobile navigation and persistent import workflow', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
  await expect(page.locator('.workspace-switch')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: /Sign in|Sign out|Set up your workspace/ }),
  ).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('button', { name: 'Audience', exact: true }).click();
  await expect(page.getByText('No contacts yet')).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
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
  await page.locator('input[type=file]').setInputFiles({
    name: 'qa-orders.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'order_id,name,email,quantity,subtotal,refund,purchased_at,city\nqa-001,Test Guest,test@example.com,2,60.00,0.00,2026-09-18T20:00:00-05:00,Austin\n',
    ),
  });
  await page.getByRole('button', { name: 'Preview import' }).click();
  await expect(page.getByRole('heading', { name: 'Review import' })).toBeVisible();
  await page.getByRole('button', { name: 'Import 1 orders' }).click();
  await expect(page.getByText('Import complete.')).toBeVisible();
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
  await page.getByRole('button', { name: 'Audience', exact: true }).click();
  await expect(page.getByText('test@example.com', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Browser worker', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Browser worker' })).toBeVisible();
  await page.getByRole('button', { name: 'Add event sync' }).first().click();
  await page.getByLabel('Crowd Control event').selectOption({ label: 'E2E Velvet Night · Austin' });
  await page.getByLabel('POSH organizer report page URL').fill('https://example.com/report');
  await page.getByRole('button', { name: 'Save event sync' }).click();
  await expect(page.getByRole('dialog').locator('.error')).toBeVisible();
  await page.getByLabel('POSH organizer report page URL').fill('https://posh.vip/event/test');
  await page.getByRole('button', { name: 'Save event sync' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Event sync saved.')).toBeVisible();
  await page.screenshot({ path: 'test-results/browser-worker-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  await expect(page.locator('.sidebar')).toHaveCSS('transform', 'matrix(1, 0, 0, 1, -238, 0)');
  await page.screenshot({
    path: 'test-results/browser-worker-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.getByRole('button', { name: 'POSH collector', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'POSH collector' })).toBeVisible();
  await expect(page.getByText('No collections yet.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Collect now' })).toBeDisabled();
  await page.screenshot({ path: 'test-results/collector-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Campaign drafts', exact: true }).click();
  await page
    .getByRole('combobox', { name: 'Event', exact: true })
    .selectOption({ label: 'E2E Velvet Night' });
  await page.getByLabel('Message', { exact: true }).fill('Join us for our next event.');
  await page.getByRole('button', { name: 'Create draft', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Audience review' })).toBeVisible();
  await expect(page.getByText('0 eligible · 0 held out for measurement')).toBeVisible();
  await page.screenshot({ path: 'test-results/campaign-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  await expect(page.locator('.sidebar')).toHaveCSS('transform', 'matrix(1, 0, 0, 1, -238, 0)');
  await page.screenshot({
    path: 'test-results/campaign-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
  expect(errors).toEqual([]);
});
