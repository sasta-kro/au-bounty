// Event journey: a teacher posts an event with seats, a student reserves one,
// the organizer reads the rotating door code, the student checks in with it
// (and is refused once with a wrong code), and the calendar affordances exist.
// Five seats with one attendee keeps the event cancellable for cleanup.

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

/** Reads the 6-digit code currently projected on the organizer screen. */
async function readDoorCode(organizer) {
  await expect(organizer.getByText('PROJECT THIS AT THE DOOR')).toBeVisible()
  const code = await organizer
    .locator('.panel-dark div')
    .filter({ hasText: /^\d{6}$/ })
    .first()
    .textContent()
  expect(code).toMatch(/^\d{6}$/)
  return code.trim()
}

test.describe('event check-in', () => {
  let prefix
  let eventId
  let teacherId

  test.beforeEach(async ({ request }) => {
    prefix = pwId('evt')
    const users = await seededUsers(request)
    teacherId = users[NAMES.teacher].id
  })

  test.afterEach(async ({ request }) => {
    if (eventId) await cancelTask(request, teacherId, eventId)
  })

  test('create, rsvp, check in with the door code', async ({ browser }) => {
    // ---- teacher creates the event (teachers may post events and extra credit)
    const teacherCtx = await browser.newContext({ baseURL: PAGE_BASE_URL })
    const teacher = await teacherCtx.newPage()
    await signIn(teacher, NAMES.teacher)

    const startsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    const pad = (n) => String(n).padStart(2, '0')
    const when = `${startsAt.getFullYear()}-${pad(startsAt.getMonth() + 1)}-${pad(startsAt.getDate())}T10:00`

    await teacher.goto('create')
    await teacher.getByRole('button', { name: 'Event', exact: true }).click()
    await teacher.locator('#task-title').fill(`${prefix} guest lecture: map making`)
    await teacher.locator('#task-content').fill('One hour on cartography, plus questions. Attendance earns extra score.')
    await teacher.getByRole('button', { name: 'Extra credit' }).click()
    await teacher.locator('#reward-detail').fill('+5 extra score')
    await teacher.locator('#max-takers').fill('5')
    await teacher.locator('#task-when').fill(when)
    await teacher.getByRole('button', { name: 'Remote / online' }).click()
    await teacher.getByRole('button', { name: 'Design', exact: true }).click()
    await teacher.getByRole('button', { name: 'Post to board' }).click()

    await expect(teacher.getByRole('heading', { name: `${prefix} guest lecture: map making` })).toBeVisible()
    await expect(teacher.getByText('QR-verified attendance')).toBeVisible()
    eventId = await teacher.evaluate(() => window.location.pathname.split('/').pop())

    // Calendar affordances render because the event has a start time.
    await expect(teacher.getByRole('button', { name: 'Download .ics' })).toBeVisible()
    await expect(teacher.getByRole('link', { name: 'Google Calendar' })).toBeVisible()

    // ---- organizer opens the check-in screen and reads the current code
    await teacher.getByRole('link', { name: 'Show check-in code' }).click()
    const code = await readDoorCode(teacher)

    // ---- student reserves a seat and opens the attendee view
    const studentCtx = await browser.newContext({ baseURL: PAGE_BASE_URL })
    const student = await studentCtx.newPage()
    await signIn(student, NAMES.studentFive)

    await searchBoard(student, prefix)
    await student.locator('.task-card').filter({ hasText: prefix }).click()
    await student.getByRole('button', { name: 'Reserve a seat' }).click()
    await expect(student.getByText('Seats reserved')).toBeVisible()
    await expect(student.getByText('1 / 5')).toBeVisible()

    await student.getByRole('link', { name: 'Check in at the venue' }).click()
    await expect(student.getByText('ENTER THE DOOR CODE')).toBeVisible()

    // ---- a wrong code is refused with the error state
    const wrong = code === '000000' ? '999999' : '000000'
    await student.getByLabel('6-digit check-in code').fill(wrong)
    await student.getByRole('button', { name: 'Verify attendance' }).click()
    await expect(student.getByRole('alert')).toContainText('That code does not match')

    // ---- the correct code verifies attendance (re-read in case it rotated)
    await student.getByLabel('6-digit check-in code').fill(code)
    await student.getByRole('button', { name: 'Verify attendance' }).click()
    await expect(student.getByText('ATTENDANCE VERIFIED')).toBeVisible({ timeout: 20_000 })

    // ---- the organizer's roster shows the check-in (a checked-in row grows a
    // timestamp; the header counts it)
    await expect(teacher.getByText('1 checked in of 1 reserved')).toBeVisible({ timeout: 20_000 })
    const attendeesCard = teacher.locator('.card').filter({ hasText: 'ATTENDEES' }).last()
    await expect(attendeesCard).toContainText(NAMES.studentFive)
    await expect(attendeesCard).toContainText(/\d{1,2}:\d{2}\s?(AM|PM)/)

    await studentCtx.close()
    await teacherCtx.close()
  })
})
