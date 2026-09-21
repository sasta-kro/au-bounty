// The full Request lifecycle through the UI: create (poster) -> take (AUTO)
// -> mark done -> confirm -> double-blind reviews both sides -> time travel
// publishes them -> public profiles, including a logged-out viewer.

const { test, expect } = require('@playwright/test')
const {
  NAMES,
  PAGE_BASE_URL,
  pwId,
  signIn,
  searchBoard,
  seededUsers,
  cancelTask,
  advanceClock,
  desktopOnly,
} = require('./helpers')

desktopOnly()

test.describe('request lifecycle', () => {
  let prefix
  let taskId
  let posterId
  let takerId

  test.beforeEach(async ({ request }) => {
    prefix = pwId('req')
    const users = await seededUsers(request)
    posterId = users[NAMES.student].id
    takerId = users[NAMES.studentFive].id
  })

  test.afterEach(async ({ request }) => {
    if (taskId) await cancelTask(request, posterId, taskId)
  })

  test('create, take, complete, confirm, review, publish', async ({ browser, request }) => {
    // ---- poster creates the request through the form
    const posterCtx = await browser.newContext({ baseURL: PAGE_BASE_URL })
    const poster = await posterCtx.newPage()
    await signIn(poster, NAMES.student)

    await poster.goto('create')
    await poster.locator('#task-title').fill(`${prefix} carry a projector`)
    await poster.locator('#task-content').fill('Pick up the projector from media services and bring it to room 601.')
    await poster.getByRole('button', { name: 'Cash', exact: true }).click()
    await poster.locator('#reward-detail').fill('200 THB')
    await poster.locator('#max-takers').fill('2')
    await poster.getByRole('button', { name: 'First come' }).click()
    await poster.getByRole('button', { name: 'Remote / online' }).click()
    await poster.getByRole('button', { name: 'Coding', exact: true }).click()
    await poster.getByRole('button', { name: 'Post to board' }).click()

    await expect(poster.getByRole('heading', { name: `${prefix} carry a projector` })).toBeVisible()
    taskId = await poster.evaluate(() => window.location.pathname.split('/').pop())
    expect(taskId).toMatch(/^[0-9a-f-]{36}$/)
    await expect(poster.getByText('APPLICANTS')).toBeVisible()

    // ---- second student takes it (AUTO) and marks the work done
    const takerCtx = await browser.newContext({ baseURL: PAGE_BASE_URL })
    const taker = await takerCtx.newPage()
    await signIn(taker, NAMES.studentFive)

    await searchBoard(taker, prefix)
    await taker.locator('.task-card').filter({ hasText: prefix }).click()
    await expect(taker.getByRole('heading', { name: `${prefix} carry a projector` })).toBeVisible()
    await taker.getByRole('button', { name: 'Take this task' }).click()
    await expect(taker.locator('.plate-gold')).toHaveText('Accepted')

    await taker.getByRole('button', { name: 'Mark work done' }).click()
    await expect(taker.locator('.plate-gold')).toHaveText('Waiting on poster')

    // ---- poster confirms completion from the applicants panel
    await poster.reload()
    const applicantRow = poster.locator('.card').filter({ hasText: 'APPLICANTS' })
      .locator('div').filter({ hasText: NAMES.studentFive }).first()
    await applicantRow.getByRole('button', { name: 'Confirm completion' }).click()
    await expect(applicantRow).toContainText('Completed')

    // ---- taker submits a review, sees the sealed state
    await taker.reload()
    await taker.getByRole('link', { name: 'Leave a review' }).click()
    await expect(taker.getByRole('heading', { name: 'Leave a review' })).toBeVisible()
    await taker.getByRole('button', { name: '5 stars' }).click()
    await taker.locator('#review-text').fill(`${prefix} quick and careful with the gear`)
    await taker.getByRole('button', { name: 'Submit review' }).click()
    await expect(taker.getByText('Review sealed')).toBeVisible()

    // ---- poster submits theirs from my-tasks, also sealed
    await poster.goto('my-tasks')
    const owed = poster.locator('.card').filter({ hasText: prefix }).first()
    await owed.getByRole('link', { name: 'Leave a review' }).click()
    await poster.getByRole('button', { name: '4 stars' }).click()
    await poster.locator('#review-text').fill(`${prefix} clear instructions, paid on the spot`)
    await poster.getByRole('button', { name: 'Submit review' }).click()
    await expect(poster.getByText('Review sealed')).toBeVisible()

    const posterText = `${prefix} clear instructions, paid on the spot`
    const takerText = `${prefix} quick and careful with the gear`

    // ---- double-blind: neither text is public yet. A review renders on the
    // reviewee's profile, so the taker's profile must not show the poster's.
    await poster.goto(`u/${takerId}`)
    await expect(poster.getByRole('heading', { name: NAMES.studentFive })).toBeVisible()
    await expect(poster.getByText(posterText)).toHaveCount(0)

    // ---- time travel: both submitted, the 1-day window closes
    await advanceClock(request, 2)

    await poster.goto(`u/${takerId}`)
    const posterReview = poster.locator('.card').filter({ hasText: posterText })
    await expect(posterReview).toHaveCount(1)
    await expect(posterReview).toContainText(NAMES.student)

    // ---- the taker's review shows on the poster's profile, readable logged out
    const anonCtx = await browser.newContext({ baseURL: PAGE_BASE_URL })
    const anon = await anonCtx.newPage()
    await anon.goto(`u/${posterId}`)
    await expect(anon.getByText('Public profile · no sign-in needed')).toBeVisible()
    const takerReview = anon.locator('.card').filter({ hasText: takerText })
    await expect(takerReview).toHaveCount(1)
    await expect(takerReview).toContainText(NAMES.studentFive)

    await anonCtx.close()
    await takerCtx.close()
    await posterCtx.close()
  })
})
