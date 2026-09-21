// The board: tabs, search, and what a card advertises (type + reward chips).

const { test, expect } = require('@playwright/test')
const { NAMES, pwId, signIn, searchBoard, seededUsers, createTask, cancelTask } = require('./helpers')

test.describe('board', () => {
  let prefix
  let task
  let posterId

  test.beforeEach(async ({ page, request }) => {
    prefix = pwId('board')
    const users = await seededUsers(request)
    posterId = users[NAMES.student].id
    // One known task this run owns, found by its unique title prefix.
    task = await createTask(request, posterId, {
      title: `${prefix} whiteboard markers`,
      content: 'Bring three markers to room 402.',
      rewardType: 'CASH',
      rewardDescription: '150 THB',
    })
    await signIn(page, NAMES.student)
  })

  test.afterEach(async ({ request }) => {
    await cancelTask(request, posterId, task.id)
  })

  test('tabs render and filter by type', async ({ page }) => {
    const tabs = page.locator('[aria-label="Filter the board"] .seg')
    await expect(tabs).toHaveText(['All', 'Matches', 'Requests', 'Events', 'Emergency'])

    await page.locator('[aria-label="Filter the board"] .seg', { hasText: 'Events' }).click()
    await expect(page.locator('.task-card').filter({ hasText: 'Event task A' })).toBeVisible()
    await expect(page.locator('.task-card').filter({ hasText: task.title })).toHaveCount(0)

    await page.locator('[aria-label="Filter the board"] .seg', { hasText: 'Requests' }).click()
    await expect(page.locator('.task-card').filter({ hasText: 'Request task A' })).toBeVisible()

    await page.locator('[aria-label="Filter the board"] .seg', { hasText: 'Matches' }).click()
    await expect(page.getByText('ranked by your skill tags')).toBeVisible()
  })

  test('search filters by title substring', async ({ page }) => {
    await searchBoard(page, prefix)
    const mine = page.locator('.task-card').filter({ hasText: task.title })
    await expect(mine).toHaveCount(1)
    await expect(page.locator('.task-card').filter({ hasText: 'Request task A' })).toHaveCount(0)

    await searchBoard(page, `${prefix}-no-such-thing`)
    await expect(page.getByText(/Nothing matches/)).toBeVisible()
    await expect(page.locator('.task-card')).toHaveCount(0)
  })

  test('task card shows reward and type chips', async ({ page }) => {
    await searchBoard(page, prefix)
    const card = page.locator('.task-card').filter({ hasText: task.title })
    await expect(card.locator('.chip-type')).toHaveText('REQUEST')
    await expect(card.locator('.chip-reward')).toHaveText('150 THB')
    await expect(card).toContainText('2 spots')
  })
})
