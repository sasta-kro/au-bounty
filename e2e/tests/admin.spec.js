// Admin console: password sign-in at /admin-login with a boot-seeded console
// account (admin.one@au.edu / admin123), the user directory search, and review
// hide-text moderation toggled back so the demo data is unchanged. The alerts
// surface is gone with the peer system; the tab set itself documents that.

const { test, expect } = require('@playwright/test')
const { desktopOnly } = require('./helpers')

desktopOnly()

const ADMIN_EMAIL = 'admin.one@au.edu'
const ADMIN_PASSWORD = 'admin123'

test.describe('admin console', () => {
  test('console sign-in, user search, review moderation', async ({ page }) => {
    // ---- password sign-in on the unlinked console form
    await page.goto('admin-login')
    await expect(page.getByText('For the accounts that moderate the board.')).toBeVisible()
    await page.locator('#admin-email').fill(ADMIN_EMAIL)
    await page.locator('#admin-password').fill(ADMIN_PASSWORD)
    await page.getByRole('button', { name: 'Sign in' }).click()

    await expect(page.getByRole('heading', { name: 'Admin console' })).toBeVisible()

    // People & roles, Organizations, Reviews. No alerts tab exists anymore.
    const tabs = page.locator('.seg-row .seg')
    await expect(tabs).toHaveText(['People & roles', 'Organizations', 'Reviews'])

    // ---- directory search narrows by name
    await page.getByLabel('Search users').fill('Student One')
    const list = page.locator('.card').filter({ hasText: 'joined' })
    await expect(list).toContainText('student.one@example.edu')
    await expect(list).not.toContainText('org.member.two@example.edu')

    // ---- review moderation: hide text, see the marker, restore it
    await page.locator('.seg-row .seg', { hasText: 'Reviews' }).click()
    const reviewRow = page
      .locator('.card > div')
      .filter({ hasText: 'Placeholder five-star review text.' })
      .first()
    await expect(reviewRow).toBeVisible()

    await reviewRow.getByRole('button', { name: 'Hide text' }).click()
    await expect(reviewRow.getByText('hidden')).toBeVisible()
    await expect(reviewRow.getByRole('button', { name: 'Show text' })).toBeVisible()

    await reviewRow.getByRole('button', { name: 'Show text' }).click()
    await expect(reviewRow.getByRole('button', { name: 'Hide text' })).toBeVisible()
    await expect(reviewRow.locator('.chip').filter({ hasText: 'hidden' })).toHaveCount(0)
  })
})
