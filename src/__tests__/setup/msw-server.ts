/**
 * MSW Server Setup for Node.js Tests
 *
 * This file configures Mock Service Worker to intercept HTTP requests
 * during integration and E2E tests.
 */

import { setupServer } from 'msw/node';
import { beforeAll, afterEach, afterAll } from 'vitest';
import { handlers } from './handlers.js';

// Create MSW server with all handlers
export const server = setupServer(...handlers);

// Start server before all tests
beforeAll(() => {
  server.listen({
    onUnhandledRequest: 'warn' // Warn about unhandled requests
  });
});

// Reset handlers after each test to ensure test isolation
afterEach(() => {
  server.resetHandlers();
});

// Clean up after all tests
afterAll(() => {
  server.close();
});
