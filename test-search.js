const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const { spawn } = require('child_process');

async function search() {
  const serverProcess = spawn('node', ['build/index.js'], {
    env: {
      ...process.env,
      BCONNECT_BASE_URL: 'https://bms-win22srv:444/bconnect',
      BCONNECT_USERNAME: 'Administrator',
      BCONNECT_PASSWORD: 'baramundi-2008',
      NODE_TLS_REJECT_UNAUTHORIZED: '0'
    }
  });

  const transport = new StdioClientTransport({
    reader: serverProcess.stdout,
    writer: serverProcess.stdin
  });

  const client = new Client({ name: 'test-client', version: '1.0.0' }, {
    capabilities: {}
  });

  await client.connect(transport);

  // Search for Windows Update issues
  const result = await client.callTool({
    name: 'search_documentation',
    arguments: {
      query: 'Windows Update deaktivieren 0x80070103 bMUM Compliance'
    }
  });

  console.log(JSON.stringify(result, null, 2));

  await client.close();
  serverProcess.kill();
}

search().catch(console.error);
