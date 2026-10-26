import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

// The packaged page loads local assets only and never talks to the network:
// all data goes through the preload bridge. The dev server is exempt because
// hot reload needs inline scripts and a websocket.
const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  // Book covers and Spotify album art come from the main process through private schemes.
  "img-src 'self' data: dt-cover: dt-spotify:",
  "font-src 'self'",
  "connect-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

function contentSecurityPolicy(): Plugin {
  return {
    name: 'day-tracker-csp',
    apply: 'build',
    transformIndexHtml: () => [
      {
        tag: 'meta',
        attrs: { 'http-equiv': 'Content-Security-Policy', content: CONTENT_SECURITY_POLICY },
        injectTo: 'head-prepend',
      },
    ],
  };
}

export default defineConfig({
  // Relative asset URLs so Electron can load the build from the filesystem.
  base: './',
  plugins: [react(), contentSecurityPolicy()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  test: {
    environment: 'jsdom',
    // Tests format times, so they run in one fixed timezone wherever they run.
    env: { TZ: 'UTC' },
    globals: true,
    setupFiles: './src/test/setup.ts',
    // Packaging runs the tests while the machine is busy; a slow render is not a failure.
    testTimeout: 20_000,
    // tokens.css is read as text by the contrast test, so it must not be emptied.
    css: { include: [/tokens\.css/], modules: { classNameStrategy: 'non-scoped' } },
  },
});
