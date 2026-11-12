import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './apps/web/e2e',
  timeout: 30000,
  use: {
    baseURL: 'http://127.0.0.1:5187',
    browserName: 'chromium',
    launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: { command: 'npm run dev:web -- --port 5187 --strictPort', url: 'http://127.0.0.1:5187', timeout: 30000, reuseExistingServer: false },
});