/**
 * MSW (Mock Service Worker) Setup for Integration Tests
 *
 * This file sets up MSW to intercept HTTP requests during integration tests.
 * MSW allows us to test the full request/response cycle without hitting the real API.
 */

import { setupServer } from 'msw/node';
import { beforeAll, afterEach, afterAll } from 'vitest';
import { handlers } from '../mocks/handlers.js';

// Create MSW server with our handlers
export const server = setupServer(...handlers);

// Start server before all tests
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'warn' });
});

// Reset handlers after each test to ensure test isolation
afterEach(() => {
  server.resetHandlers();
});

// Clean up after all tests
afterAll(() => {
  server.close();
});
