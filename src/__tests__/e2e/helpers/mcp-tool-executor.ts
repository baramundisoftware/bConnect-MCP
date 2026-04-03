/**
 * MCP Tool Executor Helper
 *
 * Provides utilities for programmatically executing MCP tools in E2E tests.
 * Simulates MCP client calling tools through the server.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, Tool } from "@modelcontextprotocol/sdk/types.js";
import { BConnectClient } from "../../../bconnect-client.js";

/**
 * MCP Tool Response structure
 */
export interface MCPToolResponse {
  content: Array<{
    type: string;
    text: string;
  }>;
  isError?: boolean;
}

/**
 * Execute an MCP tool by name with given parameters
 *
 * @param server - MCP Server instance
 * @param toolName - Name of the tool to execute
 * @param parameters - Tool parameters as object
 * @returns Promise<MCPToolResponse> - Tool execution result
 */
export async function executeMCPTool(
  server: Server,
  toolName: string,
  parameters: Record<string, any>
): Promise<MCPToolResponse> {
  try {
    // Simulate MCP client calling tool via CallToolRequest
    const result = await server.request(
      {
        method: "tools/call",
        params: {
          name: toolName,
          arguments: parameters
        }
      },
      CallToolRequestSchema
    );

    return result as MCPToolResponse;
  } catch (error: any) {
    // Return error response in MCP format
    return {
      content: [{
        type: "text",
        text: `Error executing tool '${toolName}': ${error.message}`
      }],
      isError: true
    };
  }
}

/**
 * Get list of available tools from MCP server
 *
 * @param server - MCP Server instance
 * @returns Promise<Tool[]> - Array of available tools
 */
export async function listAvailableTools(server: Server): Promise<Tool[]> {
  const result = await server.request(
    {
      method: "tools/list",
      params: {}
    },
    { method: "tools/list" } as any
  );

  return (result as any).tools || [];
}

/**
 * Validate MCP tool response structure
 *
 * @param response - MCP tool response
 * @returns boolean - True if response has valid structure
 */
export function isValidMCPResponse(response: MCPToolResponse): boolean {
  if (!response || typeof response !== 'object') {
    return false;
  }

  if (!response.content || !Array.isArray(response.content)) {
    return false;
  }

  if (response.content.length === 0) {
    return false;
  }

  // Check first content item has required properties
  const firstContent = response.content[0];
  if (!firstContent.type || !firstContent.text) {
    return false;
  }

  return true;
}

/**
 * Parse JSON response from MCP tool
 *
 * @param response - MCP tool response
 * @returns any - Parsed JSON data
 * @throws Error if response is not valid JSON
 */
export function parseMCPResponse(response: MCPToolResponse): any {
  if (!isValidMCPResponse(response)) {
    throw new Error("Invalid MCP response structure");
  }

  const textContent = response.content[0].text;

  try {
    return JSON.parse(textContent);
  } catch (error) {
    throw new Error(`Failed to parse MCP response as JSON: ${textContent}`);
  }
}

/**
 * Create a test MCP server instance with given bConnect client
 *
 * @param bconnect - BConnectClient instance
 * @returns Server - Configured MCP server instance
 */
export function createTestMCPServer(bconnect: BConnectClient): Server {
  const server = new Server(
    {
      name: "bconnect-mcp-test-server",
      version: "1.0.0-test"
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  // Tool registration will be done by the actual index.ts logic
  // This is just the server instance for testing

  return server;
}

/**
 * Assert MCP response contains expected data structure
 *
 * @param response - MCP tool response
 * @param expectedProps - Array of expected property names
 * @throws Error if expected properties are missing
 */
export function assertMCPResponseHasProps(
  response: MCPToolResponse,
  expectedProps: string[]
): void {
  const data = parseMCPResponse(response);

  for (const prop of expectedProps) {
    if (!(prop in data)) {
      throw new Error(`Expected property '${prop}' not found in MCP response data`);
    }
  }
}
