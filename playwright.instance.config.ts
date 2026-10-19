import { defineConfig } from '@playwright/test';
import base from './playwright.config.js';

const externalBaseURL = process.env.NUVEX_E2E_BASE_URL;

export default defineConfig({
  ...base,
  testMatch: ['instance.spec.ts', 'instance-races.spec.ts'],
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: { ...base.use, baseURL: externalBaseURL || base.use?.baseURL },
  // A configured external deployment must be tested through its actual web server.
  webServer: externalBaseURL ? undefined : base.webServer
});
