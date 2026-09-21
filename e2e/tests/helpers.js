// Shared plumbing: dev-picker sign-in, the REST surface the SPA uses (with
// the dev header the SPA sends), seeded-account lookup, and the PW- naming +
// cancel hygiene every created task follows.

const { expect, test } = require('@playwright/test')

const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:8080/aubounty'
// Manual browser.newContext calls need the mount-preserving form themselves.
const PAGE_BASE_URL = `${BASE_URL}/`
const API = '/aubounty/api'

// Seeded by backend/prisma/seed.js; the Campus Safety SERVICE account is
// excluded from /dev/users and never signs in.
const NAMES = {
  student: 'Student One',
  orgMember: 'Org Member Two',
  teacher: 'Teacher Three',
  studentFive: 'Student Five',
  studentSix: 'Student Six',
}

let seq = 0
/** Unique, sweepable prefix for every entity a test creates: PW-<epoch>-<n>. */
const pwId = (label = '') => `PW-${Date.now()}-${++seq}${label ? `-${label}` : ''}`

/** All seeded accounts the picker offers, keyed by display name. */
async function seededUsers(request) {
  const res = await request.get(`${API}/dev/users`)
  if (!res.ok()) throw new Error(`GET /dev/users -> ${res.status()}`)
  const { users } = await res.json()
  const byName = {}
  for (const u of users) byName[u.name] = u
  return byName
}

/** REST calls as one seeded user, mirroring the SPA's x-dev-user-id header. */
function apiAs(request, userId) {
  const call = async (method, path, data) => {
    const res = await request.fetch(`${API}${path}`, {
      method,
      headers: { 'x-dev-user-id': userId },
      ...(data === undefined ? {} : { data }),
    })
    const text = await res.text()
    if (!res.ok()) throw new Error(`${method} ${path} -> ${res.status()}: ${text}`)
    return text ? JSON.parse(text) : null
  }
  return {
    get: (path) => call('GET', path),
    post: (path, data = {}) => call('POST', path, data),
    patch: (path, data = {}) => call('PATCH', path, data),
    del: (path) => call('DELETE', path),
  }
}

/** Creates a task via the API. Remote location, so no maps key is needed. */
async function createTask(request, posterId, overrides = {}) {
  const api = apiAs(request, posterId)
  const { tags } = await api.get('/tags')
  const body = {
    title: pwId('task'),
    content: 'Created by the Playwright suite.',
    type: 'REQUEST',
    rewardType: 'NONE',
    maxTakers: 2,
    acceptanceMode: 'AUTO',
    tagIds: [tags[0].id],
    ...overrides,
  }
  const { task } = await api.post('/tasks', body)
  return task
}

/** Cancels a task as its poster so the demo board stays clean. Warns, never fails a test. */
async function cancelTask(request, posterId, taskId) {
  try {
    await apiAs(request, posterId).post(`/tasks/${taskId}/cancel`)
  } catch (err) {
    console.warn(`cleanup: cancel ${taskId} failed: ${err.message}`)
  }
}

/**
 * Time travel for the settle windows (7-day auto-confirm, review publication).
 * advance-clock shifts timestamps back; the NEXT request's settle pass applies
 * what became due, so one is made right after.
 */
async function advanceClock(request, days = 2) {
  const res = await request.fetch(`${API}/dev/advance-clock`, {
    method: 'POST',
    data: { days },
  })
  if (!res.ok()) throw new Error(`POST /dev/advance-clock -> ${res.status()}`)
  await request.get(`${API}/dev/users`) // settle pass runs on this request
}

/** Signs in through the dev picker and waits for the board. */
async function signIn(page, name) {
  await page.goto('login')
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  const card = page.locator('.login-panel button.card').filter({ hasText: name })
  await expect(card).toBeVisible()
  await card.click()
  await expect(page.getByRole('heading', { name: 'Bounty board' })).toBeVisible()
  await expect(page.locator('.sidebar')).toContainText(name)
}

/** Returns to the picker. In dev mode the shell button reads "Switch user". */
async function signOut(page) {
  await page.getByRole('button', { name: 'Switch user' }).click()
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
}

/** Types into the topbar search and waits out the 300ms debounce + refetch. */
async function searchBoard(page, query) {
  const box = page.getByRole('textbox', { name: 'Search' })
  await box.fill(query)
  await expect(box).toHaveValue(query)
  // One bounded beat for the debounce; assertions after it auto-retry anyway.
  await page.waitForTimeout(450)
}

/** Skips everything in the file unless the run is the desktop project. */
function desktopOnly() {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'desktop project only')
  })
}

module.exports = {
  BASE_URL,
  PAGE_BASE_URL,
  API,
  NAMES,
  pwId,
  seededUsers,
  apiAs,
  createTask,
  cancelTask,
  advanceClock,
  signIn,
  signOut,
  searchBoard,
  desktopOnly,
}
