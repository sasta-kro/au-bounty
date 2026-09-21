// Sanity: the two most-visited screens load with zero console errors and zero
// uncaught page errors. Fonts and sockets included.

const { test, expect } = require('@playwright/test')
const { NAMES, signIn, searchBoard } = require('./helpers')

function collectErrors(page, errors) {
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`)
  })
}

test.describe('no console errors', () => {
  test('board and task detail are clean', async ({ page }) => {
    const errors = []
    collectErrors(page, errors)

    await signIn(page, NAMES.student)

    // Let the board settle: cards, weather chip, socket connection.
    await expect(page.locator('.task-card').first()).toBeVisible()
    await page.waitForTimeout(1500)
    expect(errors, errors.join('\n')).toEqual([])

    // A request task detail: chips, applicants panel, reward rail.
    await page.locator('[aria-label="Filter the board"] .seg', { hasText: 'Requests' }).click()
    const card = page.locator('.task-card').filter({ hasText: 'Request task A' }).first()
    await expect(card).toBeVisible()
    await card.click()
    await expect(page.getByRole('heading', { name: 'Request task A' })).toBeVisible()
    await expect(page.getByText('APPLICANTS')).toBeVisible()
    await page.waitForTimeout(1500)
    expect(errors, errors.join('\n')).toEqual([])
  })

  test('board search round trip is clean', async ({ page }) => {
    const errors = []
    collectErrors(page, errors)

    await signIn(page, NAMES.student)
    await searchBoard(page, 'no-such-pw-title')
    await expect(page.getByText(/Nothing matches/)).toBeVisible()
    await page.getByLabel('Clear search').click()
    await expect(page.locator('.task-card').first()).toBeVisible()
    await page.waitForTimeout(1000)
    expect(errors, errors.join('\n')).toEqual([])
  })
})
