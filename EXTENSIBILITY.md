# Extensibility Guide

## Architecture

The bConnect MCP server uses modular architecture. Each API module is independent and self-contained.

```
src/
├── index.ts                      # MCP server (94 tools)
├── bconnect-client.ts            # Main client
├── modules/
│   ├── endpoints.ts              # ✅ 10 tools
│   ├── jobs.ts                   # ✅ 5 tools
│   ├── assets.ts                 # ✅ 13 tools
│   ├── activedirectory.ts        # ✅ 16 tools
│   ├── software.ts               # ✅ 4 tools
│   ├── updatemanagement.ts       # ✅ 2 tools
│   ├── defensecontrol.ts         # ✅ 10 tools
│   ├── variables.ts              # ✅ 9 tools
│   ├── operatingsystems.ts       # ✅ 5 tools
│   └── servermanagement.ts       # ✅ 13 tools
└── generated/
    └── *-types.ts                # TypeScript types from OpenAPI
```

## Adding a New Module

### Quick Steps

```bash
# 1. Download OpenAPI spec
curl -k -u "Administrator:baramundi-2008" \
  https://bms-win22srv:444/bconnect/assets/openAPI/v2.0/bConnect_Assets.json \
  -o openapi-assets.json

# 2. Generate TypeScript types
npx openapi-typescript openapi-assets.json -o src/generated/assets-types.ts

# 3. Create module file (see example below)
# Edit src/modules/assets.ts

# 4. Register in client (see example below)
# Edit src/bconnect-client.ts

# 5. Add MCP tools (see example below)
# Edit src/index.ts

# 6. Build and test
npm run build
npm run inspector
```

### Example Module (src/modules/assets.ts)

```typescript
import type { AxiosInstance } from "axios";
import type { paths } from "../generated/assets-types.js";

export class AssetsModule {
  private basePath = "/assets/v2.0";

  constructor(private client: AxiosInstance) {}

  async getAssets(params?: any) {
    const response = await this.client.get(`${this.basePath}/Assets`, { params });
    return response.data;
  }

  async getAsset(id: string) {
    const response = await this.client.get(`${this.basePath}/Assets/${id}`);
    return response.data;
  }
}
```

### Register Module (src/bconnect-client.ts)

```typescript
import { AssetsModule } from "./modules/assets.js";  // Add import

export class BConnectClient {
  public assets: AssetsModule;  // Add property

  constructor(config: BConnectConfig) {
    // ...
    this.assets = new AssetsModule(this.client);  // Initialize
  }
}
```

### Add MCP Tools (src/index.ts)

```typescript
// In ListToolsRequestSchema handler:
{
  name: "list_assets",
  description: "List all assets in baramundi",
  inputSchema: {
    type: "object",
    properties: {
      PageSize: { type: "number" }
    }
  }
}

// In CallToolRequestSchema handler:
case "list_assets":
  const assets = await bconnect.assets.getAssets(args);
  return {
    content: [{ type: "text", text: JSON.stringify(assets, null, 2) }]
  };
```

## Implemented APIs

All 10 bConnect API modules are now implemented:

| API | Status | MCP Tools | OpenAPI Spec |
|-----|--------|-----------|--------------|
| Endpoints | ✅ Implemented | 10 | `/endpoints/openAPI/v2.0/bConnect_Endpoints.json` |
| Jobs | ✅ Implemented | 5 | `/jobs/openAPI/v2.0/bConnect_Jobs.json` |
| Assets | ✅ Implemented | 13 | `/assets/openAPI/v2.0/bConnect_Assets.json` |
| Active Directory | ✅ Implemented | 16 | `/activedirectory/openAPI/v2.0/bConnect_ActiveDirectory.json` |
| Server Management | ✅ Implemented | 13 | `/servermanagement/openAPI/v2.0/bConnect_ServerManagement.json` |
| Defense Control | ✅ Implemented | 10 | `/defensecontrol/openAPI/v2.0/bConnect_DefenseControl.json` |
| Variables | ✅ Implemented | 9 | `/variables/openAPI/v2.0/bConnect_Variables.json` |
| Operating Systems | ✅ Implemented | 5 | `/operatingsystems/openAPI/v2.0/bConnect_OperatingSystems.json` |
| Software | ✅ Implemented | 4 | `/software/openAPI/v2.0/bConnect_Software.json` |
| Update Management | ✅ Implemented | 2 | `/updatemanagement/openAPI/v2.0/bConnect_UpdateManagement.json` |

**Total: 94 MCP tools across 10 modules**

## Checklist

When adding a module:

- [ ] Download OpenAPI spec
- [ ] Generate TypeScript types
- [ ] Create module class in `src/modules/`
- [ ] Register in `BConnectClient`
- [ ] Add MCP tools in `index.ts`
- [ ] Build succeeds (`npm run build`)
- [ ] Test with inspector (`npm run inspector`)

## Testing

```bash
# Test with MCP Inspector
npm run inspector

# Or test module directly
node -e "
import('./build/bconnect-client.js').then(async ({ BConnectClient }) => {
  const client = new BConnectClient({
    baseUrl: 'https://bms-win22srv:444/bconnect',
    username: 'Administrator',
    password: 'baramundi-2008',
    rejectUnauthorized: false
  });

  const result = await client.assets.getAssets();
  console.log(result);
});
"
```

## Reference

See `src/modules/endpoints.ts` for a complete working example.
