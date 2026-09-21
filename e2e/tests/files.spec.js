// Attachments: presign-then-PUT through the browser against MinIO
// (S3_PUBLIC_ENDPOINT=http://localhost:9100), so real bytes move. A poster
// attaches a text file to a task and downloads it back byte-for-byte, then a
// second file rides along with a chat message.

const { test, expect } = require('@playwright/test')
const { readFile } = require('node:fs/promises')
const {
  NAMES,
  pwId,
  signIn,
  seededUsers,
  createTask,
  cancelTask,
  apiAs,
  desktopOnly,
} = require('./helpers')

desktopOnly()

test.describe('attachments', () => {
  let prefix
  let task
  let posterId
  let takerId

  test.beforeEach(async ({ request }) => {
    prefix = pwId('file')
    const users = await seededUsers(request)
    posterId = users[NAMES.student].id
    takerId = users[NAMES.studentFive].id
    task = await createTask(request, posterId, {
      title: `${prefix} scan the handout`,
      content: 'Task that carries files for the attachment journey.',
    })
    await apiAs(request, takerId).post(`/tasks/${task.id}/apply`)
  })

  test.afterEach(async ({ request }) => {
    if (task) await cancelTask(request, posterId, task.id)
  })

  test('task attachment uploads and downloads back', async ({ page }) => {
    const content = `${prefix} these bytes round-trip through minio\n`
    await signIn(page, NAMES.student)
    await page.goto(`tasks/${task.id}`)
    await expect(page.getByRole('heading', { name: task.title })).toBeVisible()
    await expect(page.getByText('Nothing attached yet.')).toBeVisible()

    // Pick the file: the progress row appears, then settles into a chip.
    await page.setInputFiles('input[aria-label="Attach a file"]', {
      name: `${prefix}-handout.txt`,
      mimeType: 'text/plain',
      buffer: Buffer.from(content, 'utf8'),
    })
    const chip = page.locator('.attach-chip').filter({ hasText: `${prefix}-handout.txt` })
    await expect(chip).toBeVisible({ timeout: 20_000 })

    // Download it back through the presigned GET URL and compare bytes.
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: `Download ${prefix}-handout.txt` }).click(),
    ])
    expect(download.suggestedFilename()).toBe(`${prefix}-handout.txt`)
    const roundTrip = await readFile(await download.path(), 'utf8')
    expect(roundTrip).toBe(content)
  })

  test('composer attachment sends with a message', async ({ page }) => {
    const content = `${prefix} message payload\n`
    await signIn(page, NAMES.student)
    await page.goto('messages')
    const row = page.locator('.thread-row').filter({ hasText: task.title })
    await expect(row).toBeVisible()
    await row.click()

    await page.setInputFiles('input[aria-label="Attach"]', {
      name: `${prefix}-sheet.txt`,
      mimeType: 'text/plain',
      buffer: Buffer.from(content, 'utf8'),
    })
    await expect(page.getByText('Sends with your next message')).toBeVisible()

    await page.getByRole('textbox', { name: 'Message' }).fill(`${prefix} the sheet is attached`)
    await page.getByRole('button', { name: 'Send' }).click()

    const bubble = page.locator('.msg-bubble').filter({ hasText: `${prefix} the sheet is attached` })
    await expect(bubble).toHaveCount(1)
    await expect(bubble.locator('.attach-chip').filter({ hasText: `${prefix}-sheet.txt` }))
      .toBeVisible({ timeout: 20_000 })
  })
})
