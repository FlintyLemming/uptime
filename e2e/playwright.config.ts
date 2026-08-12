import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  timeout: 6 * 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3000',
    viewport: { width: 1280, height: 900 },
    actionTimeout: 15_000,
  },
})
