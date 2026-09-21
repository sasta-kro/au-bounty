// Dev-picker auth: Microsoft SSO exists (meta.auth) but is unconfigured in
// this stack, so meta.devAuth is true and the picker is the sign-in surface.

const { test, expect } = require('@playwright/test')
const { NAMES, signIn, signOut } = require('./helpers')

test.describe('picker auth', () => {
  test('picker login lands on the board', async ({ page }) => {
    await page.goto('/')
    // Nobody signed in: the app routes to the login screen.
    await expect(page).toHaveURL(/\/login$/)
    await expect(page.getByText('Pick one of the seeded accounts.')).toBeVisible()

    await signIn(page, NAMES.student)

    await expect(page).toHaveURL(/\/aubounty\/?$/)
    await expect(page.getByRole('heading', { name: 'Bounty board' })).toBeVisible()
  })

  test('session survives a reload', async ({ page }) => {
    await signIn(page, NAMES.studentFive)

    await page.reload()
    await expect(page.getByRole('heading', { name: 'Bounty board' })).toBeVisible()
    await expect(page.locator('.sidebar')).toContainText(NAMES.studentFive)
    await expect(page).not.toHaveURL(/\/login/)
  })

  test('sign out returns to the login picker', async ({ page }, testInfo) => {
    // The shell's sign-out control is hidden on narrow viewports.
    test.skip(testInfo.project.name === 'mobile', 'sign-out button is hidden on mobile widths')

    await signIn(page, NAMES.student)
    await signOut(page)

    await expect(page).toHaveURL(/\/login$/)
    await expect(page.getByText('Pick one of the seeded accounts.')).toBeVisible()
    await expect(page.locator('.login-panel button.card').filter({ hasText: NAMES.teacher })).toBeVisible()
  })
})
