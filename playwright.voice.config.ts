import { defineConfig } from '@playwright/test';
import base from './playwright.instance.config.js';

export default defineConfig({
  ...base,
  testMatch: 'voice.spec.ts',
  outputDir: '.cache/voice-playwright',
  timeout: 90_000,
  use: {
    ...base.use,
    permissions: ['microphone'],
    launchOptions: {
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required']
    }
  }
});
