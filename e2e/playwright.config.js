// AU Bounty E2E: runs against the compose stack (postgres + minio + api +
// nginx). The webServer boots or reuses it, so `npx playwright test` from e2e/
// is the whole setup. Chromium is the only browser; a desktop and a phone
// viewport make the two projects.

const { defineConfig } = require('@playwright/test')

const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:8080/aubounty'

module.exports = defineConfig({
  testDir: './tests',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  // The whole suite shares one database and one seeded user set, and several
  // journeys move the same rows (advance-clock touches every unpublished
  // review), so tests run serially in file order.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    actionTimeout: 15_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      use: {
        browserName: 'chromium',
        viewport: { width: 1280, height: 900 },
      },
    },
    {
      name: 'mobile',
      use: {
        browserName: 'chromium',
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: {
    // PEER_HOST_PORT is vestigial (the peer service was removed in release
    // 0.4) but harmless; kept so the command matches the documented stack boot.
    command: 'PEER_HOST_PORT=7001 docker compose up -d --build --wait',
    cwd: '..',
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    stdout: 'ignore',
  },
})
