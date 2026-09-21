// Messaging: two browser contexts sharing one assignment thread. Live
// delivery over the socket (no reload), unread badge on the away side, read
// receipt for the sender, and the phone-width composer round trip.

const { test, expect } = require('@playwright/test')
const {
  NAMES,
  PAGE_BASE_URL,
  pwId,
  signIn,
  seededUsers,
  apiAs,
  createTask,
  cancelTask,
} = require('./helpers')

test.describe('messages (desktop)', () => {
  desktopGate()

  let prefix
  let task
  let posterId
  let takerId

  test.beforeEach(async ({ request }) => {
    prefix = pwId('msg')
    const users = await seededUsers(request)
    posterId = users[NAMES.student].id
    takerId = users[NAMES.studentFive].id
    // Poster posts, taker takes (AUTO): the assignment opens the thread.
    task = await createTask(request, posterId, {
      title: `${prefix} set up the projector`,
      content: 'Thread for the messaging journey.',
    })
    await apiAs(request, takerId).post(`/tasks/${task.id}/apply`)
  })

  test.afterEach(async ({ request }) => {
    if (task) await cancelTask(request, posterId, task.id)
  })

  test('live delivery, unread badge, read receipt', async ({ browser }) => {
    const aCtx = await browser.newContext({ baseURL: PAGE_BASE_URL })
    const a = await aCtx.newPage()
    await signIn(a, NAMES.student)
    const bCtx = await browser.newContext({ baseURL: PAGE_BASE_URL })
    const b = await bCtx.newPage()
    await signIn(b, NAMES.studentFive)

    const hello = `${prefix} hello from the poster`
    const away = `${prefix} delivered while you were away`

    // Both open the shared thread from the inbox.
    for (const p of [a, b]) {
      await p.goto('messages')
      const row = p.locator('.thread-row').filter({ hasText: task.title })
      await expect(row).toBeVisible()
      await row.click()
      await expect(p.getByPlaceholder(/Message/)).toBeVisible()
    }

    // Live delivery: B sees A's message without any reload.
    await a.getByRole('textbox', { name: 'Message' }).fill(hello)
    await a.getByRole('button', { name: 'Send' }).click()
    await expect(a.locator('.msg-bubble').filter({ hasText: hello })).toHaveCount(1)
    await expect(b.locator('.msg-bubble').filter({ hasText: hello })).toHaveCount(1)

    // B walks away to the board; A sends again; B's Messages badge grows.
    await b.goto('./')
    await expect(b.getByRole('heading', { name: 'Bounty board' })).toBeVisible()
    await a.getByRole('textbox', { name: 'Message' }).fill(away)
    await a.getByRole('button', { name: 'Send' }).click()
    await expect(a.locator('.msg-bubble').filter({ hasText: away })).toHaveCount(1)
    await expect(b.locator('.nav-item').filter({ hasText: 'Messages' }).locator('.nav-badge'))
      .toHaveText(/\d+/)

    // B comes back: the thread row carries the unread badge.
    await b.goto('messages')
    const bRow = b.locator('.thread-row').filter({ hasText: task.title })
    await expect(bRow.locator('.unread-badge')).toHaveText(/\d+/)
    await bRow.click()

    // Read receipt: B reading the thread ticks A's bubbles as Read.
    await expect(b.locator('.msg-bubble').filter({ hasText: away })).toHaveCount(1)
    await expect(a.locator('.msg-own').filter({ hasText: away }).locator('.msg-read'))
      .toBeVisible({ timeout: 20_000 })

    await aCtx.close()
    await bCtx.close()
  })
})

test.describe('messages (mobile)', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'mobile project only')
  })

  let prefix
  let task
  let posterId
  let takerId

  test.beforeEach(async ({ request }) => {
    prefix = pwId('mmsg')
    const users = await seededUsers(request)
    posterId = users[NAMES.student].id
    takerId = users[NAMES.studentFive].id
    task = await createTask(request, posterId, {
      title: `${prefix} mobile thread`,
      content: 'Thread for the phone-width messaging journey.',
    })
    await apiAs(request, takerId).post(`/tasks/${task.id}/apply`)
  })

  test.afterEach(async ({ request }) => {
    if (task) await cancelTask(request, posterId, task.id)
  })

  test('open thread, send, back to list', async ({ page }) => {
    await signIn(page, NAMES.student)
    await page.goto('messages')

    // Narrow width: the list pane until a thread is picked.
    const row = page.locator('.thread-row').filter({ hasText: task.title })
    await expect(row).toBeVisible()
    await row.click()

    const note = `${prefix} typed with thumbs`
    await page.getByRole('textbox', { name: 'Message' }).fill(note)
    await page.getByRole('button', { name: 'Send' }).click()
    await expect(page.locator('.msg-bubble').filter({ hasText: note })).toHaveCount(1)

    await page.getByRole('button', { name: 'Back to conversations' }).click()
    await expect(page.locator('.thread-row').filter({ hasText: task.title })).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Message' })).toHaveCount(0)
  })
})

function desktopGate() {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'desktop project only')
  })
}
