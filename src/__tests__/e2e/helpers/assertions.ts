/**
 * Custom Assertions for E2E Tests
 *
 * Provides specialized assertion functions for validating MCP tool responses.
 * Makes E2E tests more readable and maintainable.
 */

import { expect } from 'vitest';
import { MCPToolResponse } from './mcp-tool-executor.js';

/**
 * Assert that response is a valid MCP tool response structure
 */
export function expectValidMCPResponse(response: MCPToolResponse) {
  expect(response).toBeDefined();
  expect(response).toHaveProperty('content');
  expect(response.content).toBeInstanceOf(Array);
  expect(response.content.length).toBeGreaterThan(0);
  expect(response.content[0]).toHaveProperty('type');
  expect(response.content[0]).toHaveProperty('text');
  expect(response.content[0].type).toBe('text');
}

/**
 * Assert that response is an error response
 */
export function expectErrorResponse(response: MCPToolResponse) {
  expectValidMCPResponse(response);
  expect(response.isError).toBe(true);
}

/**
 * Assert that response is a success response (not an error)
 */
export function expectSuccessResponse(response: MCPToolResponse) {
  expectValidMCPResponse(response);
  expect(response.isError).not.toBe(true);
}

/**
 * Assert that response contains JSON data
 */
export function expectJSONResponse(response: MCPToolResponse) {
  expectValidMCPResponse(response);

  const textContent = response.content[0].text;
  let parsed: any;

  expect(() => {
    parsed = JSON.parse(textContent);
  }).not.toThrow();

  return parsed;
}

/**
 * Assert that JSON response has expected properties
 */
export function expectResponseHasProperties(
  response: MCPToolResponse,
  expectedProps: string[]
) {
  const data = expectJSONResponse(response);

  for (const prop of expectedProps) {
    expect(data).toHaveProperty(prop);
  }

  return data;
}

/**
 * Assert that response is a paginated list response
 */
export function expectPaginatedResponse(response: MCPToolResponse) {
  const data = expectResponseHasProperties(response, [
    'totalItems',
    'pageSize',
    'page',
    'data'
  ]);

  expect(data.totalItems).toBeTypeOf('number');
  expect(data.pageSize).toBeTypeOf('number');
  expect(data.page).toBeTypeOf('number');
  expect(data.data).toBeInstanceOf(Array);

  return data;
}

/**
 * Assert that paginated response has expected page size
 */
export function expectPageSize(
  response: MCPToolResponse,
  expectedPageSize: number
) {
  const data = expectPaginatedResponse(response);

  expect(data.pageSize).toBe(expectedPageSize);
  expect(data.data.length).toBeLessThanOrEqual(expectedPageSize);

  return data;
}

/**
 * Assert that paginated response is on expected page
 */
export function expectPageNumber(
  response: MCPToolResponse,
  expectedPage: number
) {
  const data = expectPaginatedResponse(response);

  expect(data.page).toBe(expectedPage);

  return data;
}

/**
 * Assert that response contains specific data item by ID
 */
export function expectDataItemWithId(
  response: MCPToolResponse,
  expectedId: string
) {
  const data = expectJSONResponse(response);

  // Single item response
  if (data.id) {
    expect(data.id).toBe(expectedId);
    return data;
  }

  // Paginated list response
  if (data.data && Array.isArray(data.data)) {
    const item = data.data.find((item: any) => item.id === expectedId);
    expect(item).toBeDefined();
    return item;
  }

  throw new Error(`Response does not contain item with ID: ${expectedId}`);
}

/**
 * Assert that all items in paginated response have required properties
 */
export function expectAllItemsHaveProperties(
  response: MCPToolResponse,
  requiredProps: string[]
) {
  const data = expectPaginatedResponse(response);

  for (const item of data.data) {
    for (const prop of requiredProps) {
      expect(item).toHaveProperty(prop);
    }
  }

  return data;
}

/**
 * Assert that response data matches expected count
 */
export function expectItemCount(
  response: MCPToolResponse,
  expectedCount: number
) {
  const data = expectPaginatedResponse(response);

  expect(data.data.length).toBe(expectedCount);

  return data;
}

/**
 * Assert that total items count is greater than zero
 */
export function expectNonEmptyResults(response: MCPToolResponse) {
  const data = expectPaginatedResponse(response);

  expect(data.totalItems).toBeGreaterThan(0);
  expect(data.data.length).toBeGreaterThan(0);

  return data;
}

/**
 * Assert that response contains empty results
 */
export function expectEmptyResults(response: MCPToolResponse) {
  const data = expectPaginatedResponse(response);

  expect(data.totalItems).toBe(0);
  expect(data.data.length).toBe(0);

  return data;
}

/**
 * Assert that response data is sorted by property
 */
export function expectSortedBy(
  response: MCPToolResponse,
  property: string,
  order: 'asc' | 'desc' = 'asc'
) {
  const data = expectPaginatedResponse(response);

  if (data.data.length < 2) {
    return data; // Cannot verify sort order with less than 2 items
  }

  for (let i = 0; i < data.data.length - 1; i++) {
    const current = data.data[i][property];
    const next = data.data[i + 1][property];

    if (order === 'asc') {
      expect(current).toBeLessThanOrEqual(next);
    } else {
      expect(current).toBeGreaterThanOrEqual(next);
    }
  }

  return data;
}

/**
 * Assert that response contains search results matching query
 */
export function expectSearchResults(
  response: MCPToolResponse,
  searchQuery: string,
  searchableProperties: string[]
) {
  const data = expectPaginatedResponse(response);

  if (data.data.length === 0) {
    return data; // No results to check
  }

  // Check that at least one item has a property matching the search query
  const hasMatch = data.data.some((item: any) => {
    return searchableProperties.some(prop => {
      const value = item[prop];
      if (typeof value === 'string') {
        return value.toLowerCase().includes(searchQuery.toLowerCase());
      }
      return false;
    });
  });

  expect(hasMatch).toBe(true);

  return data;
}

/**
 * Assert that response time is within acceptable range
 */
export function expectAcceptableResponseTime(
  startTime: number,
  endTime: number,
  maxMilliseconds: number = 5000
) {
  const duration = endTime - startTime;

  expect(duration).toBeLessThanOrEqual(maxMilliseconds);

  return duration;
}

/**
 * Assert that two paginated responses are different pages
 */
export function expectDifferentPages(
  response1: MCPToolResponse,
  response2: MCPToolResponse
) {
  const data1 = expectPaginatedResponse(response1);
  const data2 = expectPaginatedResponse(response2);

  // Pages should have different page numbers
  expect(data1.page).not.toBe(data2.page);

  // If both pages have data, first items should be different
  if (data1.data.length > 0 && data2.data.length > 0) {
    const firstId1 = data1.data[0].id;
    const firstId2 = data2.data[0].id;
    expect(firstId1).not.toBe(firstId2);
  }

  return { data1, data2 };
}

/**
 * Assert that response contains error message matching pattern
 */
export function expectErrorMessage(
  response: MCPToolResponse,
  expectedPattern: string | RegExp
) {
  expectErrorResponse(response);

  const textContent = response.content[0].text;

  if (typeof expectedPattern === 'string') {
    expect(textContent).toContain(expectedPattern);
  } else {
    expect(textContent).toMatch(expectedPattern);
  }

  return textContent;
}

/**
 * Assert that all required endpoints/tools are available
 */
export function expectToolsAvailable(
  availableTools: any[],
  requiredToolNames: string[]
) {
  const toolNames = availableTools.map(tool => tool.name);

  for (const requiredTool of requiredToolNames) {
    expect(toolNames).toContain(requiredTool);
  }

  return availableTools;
}

/**
 * Assert that tool has expected input schema properties
 */
export function expectToolInputSchema(
  tool: any,
  expectedProps: string[]
) {
  expect(tool).toHaveProperty('inputSchema');
  expect(tool.inputSchema).toHaveProperty('properties');

  const inputProps = Object.keys(tool.inputSchema.properties);

  for (const expectedProp of expectedProps) {
    expect(inputProps).toContain(expectedProp);
  }

  return tool.inputSchema;
}
