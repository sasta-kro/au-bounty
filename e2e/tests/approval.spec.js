// APPROVAL acceptance mode: apply -> poster accepts from the applicants
// panel -> taker completes -> poster confirms. Two spots, so the task stays
// cancellable for cleanup.

const { test, expect } = require('@playwright/test')
const {
  NAMES,
  PAGE_BASE_URL,
  pwId,
  signIn,
  searchBoard,
  seededUsers,
  cancelTask,
  desktopOnly,
} = require('./helpers')

desktopOnly()

test.describe('approval mode lifecycle', () => {
  let prefix
  let taskId
  let posterId

  test.beforeEach(async ({ request }) => {
    prefix = pwId('appr')
    const users = await seededUsers(request)
    posterId = users[NAMES.student].id
  })

  test.afterEach(async ({ request }) => {
    if (taskId) await cancelTask(request, posterId, taskId)
  })

  test('apply, accept, complete, confirm', async ({ browser }) => {
    // ---- poster creates an apply-and-approve request (the form default)
    const posterCtx = await browser.newContext({ baseURL: PAGE_BASE_URL })
    const poster = await posterCtx.newPage()
    await signIn(poster, NAMES.student)

    await poster.goto('create')
    await poster.locator('#task-title').fill(`${prefix} proofread an abstract`)
    await poster.locator('#task-content').fill('Two paragraphs, engineering abstract, tonight if possible.')
    await poster.getByRole('button', { name: 'Other', exact: true }).click()
    await poster.locator('#reward-detail').fill('A coffee')
    await poster.locator('#max-takers').fill('2')
    await poster.getByRole('button', { name: 'Apply & approve' }).click()
    await poster.getByRole('button', { name: 'Remote / online' }).click()
    await poster.getByRole('button', { name: 'Writing', exact: true }).click()
    await poster.getByRole('button', { name: 'Post to board' }).click()

    await expect(poster.getByRole('heading', { name: `${prefix} proofread an abstract` })).toBeVisible()
    taskId = await poster.evaluate(() => window.location.pathname.split('/').pop())

    // ---- second student applies
    const takerCtx = await browser.newContext({ baseURL: PAGE_BASE_URL })
    const taker = await takerCtx.newPage()
    await signIn(taker, NAMES.studentFive)

    await searchBoard(taker, prefix)
    await taker.locator('.task-card').filter({ hasText: prefix }).click()
    await taker.getByRole('button', { name: 'Apply to help' }).click()
    await expect(taker.locator('.plate-gold')).toHaveText('Applied')

    // ---- poster accepts from the applicants panel
    await poster.reload()
    const applicantsCard = poster.locator('.card').filter({ hasText: 'APPLICANTS' })
    await expect(applicantsCard).toContainText(NAMES.studentFive)
    await applicantsCard.getByRole('button', { name: 'Accept', exact: true }).click()
    await expect(applicantsCard).toContainText('Accepted')

    // ---- accepted taker completes, poster confirms
    await taker.reload()
    await expect(taker.locator('.plate-gold')).toHaveText('Accepted')
    await taker.getByRole('button', { name: 'Mark work done' }).click()
    await expect(taker.locator('.plate-gold')).toHaveText('Waiting on poster')

    await poster.reload()
    await applicantsCard.getByRole('button', { name: 'Confirm completion' }).click()
    await expect(applicantsCard).toContainText('Completed')

    await takerCtx.close()
    await posterCtx.close()
  })
})
