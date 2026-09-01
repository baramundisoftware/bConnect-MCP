#!/usr/bin/env node

/**
 * bconnect-activedirectory-mcp
 *
 * A Model Context Protocol server that provides access to the baramundi
 * bConnect REST API for Active Directory management — AD groups, users,
 * objects, and organizational units synchronized via AD sync.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import express from "express";
// OPT-32 — the unified bootstrap. Read packages/mcp-core/src/run-server.ts
// before changing anything below: it records which behaviour each of the
// thirteen hand-written main()s had and which one survived.
import { runServer, shouldAutoStart, describeConnectionFailure } from "@bconnect/mcp-core";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode
} from "@modelcontextprotocol/sdk/types.js";
import { BConnectClient } from "./bconnect-client.js";
import { createClientProvider } from "@bconnect/mcp-core";
import { validateOrThrow, serializeToolResult } from "@bconnect/mcp-core";
// Finding A2 / INT-53 — throw BareMcpError, never McpError, out of a request
// handler: McpError bakes "MCP error <code>: " into .message and the SDK adds
// it again client-side. `instanceof McpError` still holds, so the catch-all
// guards below are unaffected. See packages/mcp-core/src/protocol-error.ts.
import { BareMcpError } from "@bconnect/mcp-core";
// TOK-20 / TOK-25 / TOK-10 / INT-53 — the shared composition layer. See
// packages/mcp-core/src/{tool-catalogue,count-only,schema-fragments,tool-error}.ts.
import {
  defineToolCatalogue,
  handleToolError,
  toolTextResult,
  apiParams,
  isCountOnlyRequest,
  fetchCount,
  countOnlyProperty,
  pageProperties,
  createListShaper,
  detailProperty,
  fieldsProperty,
  type ListEnvelope,
  type Row,
} from "@bconnect/mcp-core";
import { ActiveDirectoryRules } from "./utils/mcp-tool-validation-rules.js";

/**
 * The compact projection for `list_org_units`.
 *
 * Measured live: 6,576 B for a 20-row page, of which `comment` is 51.5%.
 *
 * ── The skew warning, checked and not upheld ────────────────────────────────
 * The review that ranked this tool flagged the captured page as unrepresentative
 * — 13 of its 20 rows being `CN=…,CN=System` containers carrying the longest
 * comments. So all 133 org units were walked, seven pages, before anything was
 * built. `comment`'s share is 51.5 / 52.4 / 50.9 / 51.9 / 52.3 / 52.1 / 51.4 %
 * page by page and 52.8% pooled: uniform, not skewed. The saving generalises
 * across the population rather than being an artefact of page 1.
 *
 * ── Why `comment` specifically ──────────────────────────────────────────────
 * It is machine-written provenance, not content. Of 133 org units, 131 carry a
 * comment and **every one of them** matches "Automatically created|updated by
 * ADSync from LDAP://… on <date>"; zero are human-written. The directory
 * position it embeds is already available structurally in `parent` and
 * `parentId`, which the projection keeps.
 *
 * Unlike the AD group/object/user rows, org units have NO `ldapPath` column, so
 * `shapeAdComments`'s elision never applied here and there is no upstream
 * `meta` to compose with — checked on all seven pages.
 *
 *   whole population   44,490 -> 22,173 B   -22,317 B (-50.2%)
 *   one 20-row page     6,576 ->  3,296 B    -3,280 B (-49.9%)
 *
 * `dropConstantColumns` is included and measured **0 B on all seven pages** —
 * no page of this estate shares one parent OU. It is free here because
 * `alwaysDrop` already emits a `meta` block, so the constant rule adds no key
 * when it finds nothing; it is carried for the shallow directories where a page
 * DOES sit under a single parent, and `parentId` is 15.2% of the payload there.
 *
 * ── Do NOT generalise this to the other folder tools ────────────────────────
 * The obvious next move — one `shapeFolders` config for `list_job_folders`,
 * `list_os_folders`, `list_bundle_folders`, `list_asset_stock_folders`,
 * `list_asset_type_folders` and `list_udg_folders`, which return the same five
 * columns — was costed on 2026-08-13 and does not pay. Measured across the
 * whole population of all six:
 *
 *   - `comment` there is HUMAN-WRITTEN, which is the exact opposite of the
 *     finding above. Of the folder rows carrying one, **0 match the ADSync
 *     shape and all of them are hand-typed labels** ("Patching Jobs",
 *     "Install Jobs for Applications", "Network Scanning Jobs"). Dropping it
 *     would remove content, not provenance.
 *   - `dropConstantColumns` yields **109 B across all six tools combined**.
 *     `list_job_folders` — the biggest at 5,844 B over 36 rows — has no
 *     constant column at all, and the three single-row tools yield nothing
 *     because the rule is gated at minRows=2.
 *
 * 109 B against ~1,900 B of permanent catalogue for six `detail`/`fields`
 * pairs. The saving here came from `comment` being machine-written; that is a
 * fact about ADSync, not about folders.
 */
const shapeOrgUnits = createListShaper({
  alwaysDrop: ["comment"],
  dropConstantColumns: true,
});

/**
 * The same projection for the AD group / object / user rows.
 *
 * ── Held to the org-unit standard above, and it survived ────────────────────
 * That shaper exists because a review rejected page-1 sampling, so the whole
 * population was walked first. Same discipline here: all 60 AD objects, all 52
 * groups and all 8 users were walked (2026-08-13), not one page each.
 *
 *   comment share, page by page:  objects 17.1 / 17.2 / 17.3 %
 *                                 groups  17.0 / 17.3 / 16.9 %
 *                                 users   13.4 %
 *
 * Uniform, not a page-1 artefact, and lower than the org units' 52% for a good
 * reason: `shapeAdComments` below has ALREADY elided the ldapPath echo out of
 * these comments (OPT-4). What is left is the boilerplate shell around it.
 *
 * ── Why `comment` goes, and why nothing else does ───────────────────────────
 * 120 of 120 rows carry a comment and **every one** matches "Automatically
 * created|updated by ADSync from … on <date>". Zero are human-written. The
 * directory position it embeds is available structurally in `orgUnit`,
 * `orgUnitId` and `ldapPath`, all of which the projection KEEPS.
 *
 * `ldapPath`, `sid` and `objectGuid` are deliberately kept. An earlier ranking
 * of this tool asserted `ldapPath` was "derivable from orgUnitId + name" — it
 * is not, and the estate says so: it carries the nested OU hierarchy
 * ("OU=Users,OU=labcorp") that the leaf `orgUnit` name alone cannot express.
 * `sid` and `objectGuid` are AD-native identities distinct from bMS's `id`.
 * None of the three is provable noise, so none is dropped.
 *
 * `dropConstantColumns` earns its place here rather than being carried in
 * hope, which it was for the org units: measured on every page walked,
 * `domain` is single-valued on all of them, `type` on every group page, and
 * `mail` / `managerUserPrincipalName` on the user page. They are reported once
 * under `meta.constant` instead of once per row.
 */
const shapeAdRows = createListShaper({
  alwaysDrop: ["comment"],
  dropConstantColumns: true,
});

// ─── Factory exported for testing ───────────────────────────────────────────

export interface BConnectCredentials {
  baseUrl?: string;
  username?: string;
  password?: string;
  apiKey?: string;
}

export function createServer(credentials?: BConnectCredentials): { server: Server; getClient: () => BConnectClient } {
  const server = new Server(
    {
      name: "bconnect-activedirectory-mcp",
      version: "26.1.8"
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  // ── Tool catalogue ────────────────────────────────────────────────────────
  //
  // This server is read-only — every route it reaches is a GET. The catalogue is
  // still used for its duplicate-name check and so that a write added later is
  // gated by construction rather than by remembering a hand-maintained set (F21).

  const TOOLS = [

        // ── AD Groups ─────────────────────────────────────────────────────
        {
          name: "list_ad_groups",
          description: "List all Active Directory groups synchronized into baramundi Management Suite. Returns a paged list of AD groups with their GUIDs, names, domains, SIDs, and types. Use this to browse all available AD groups before querying specific ones. countOnly:true answers 'how many' without fetching a page. Compact by default: comment and single-valued columns are dropped, both named in meta; detail:true returns the full record.",
          inputSchema: {
            type: "object",
            properties: {
              SearchQuery: {
                type: "string",
                description: "Filter results by matching against Name, SID, Domain, Comment, Type, or GUID."
              },
              OrderBy: {
                type: "string",
                description: "Sort results by property name and direction. Possible values: Name, SID, Domain, Type (e.g. 'Name asc')."
              },
              ...pageProperties,
              ...countOnlyProperty,
              ...detailProperty,
              ...fieldsProperty,
            },
            required: []
          }
        },

        {
          name: "get_ad_group",
          description: "Get detailed information for a specific Active Directory group by its GUID. Returns the AD group name, domain, SID, type, comment, and GUID in Active Directory. Use list_ad_groups to discover group GUIDs.",
          inputSchema: {
            type: "object",
            properties: {
              id: {
                type: "string",
                description: "GUID of the AD group to retrieve."
              }
            },
            required: ["id"]
          }
        },

        {
          name: "list_ad_subgroups",
          description: "List all Active Directory sub-groups (nested groups) directly contained within a specific parent AD group. Returns a paged list of AD groups belonging to the given parent group GUID. Use get_ad_group to find the parent group GUID first. Compact by default: comment and single-valued columns are dropped, both named in meta; detail:true returns the full record.",
          inputSchema: {
            type: "object",
            properties: {
              adGroupId: {
                type: "string",
                description: "GUID of the parent AD group whose sub-groups to list."
              },
              SearchQuery: {
                type: "string",
                description: "Filter results by matching against Name, SID, Domain, Comment, Type, or GUID."
              },
              OrderBy: {
                type: "string",
                description: "Sort results by property name and direction (e.g. 'Name asc')."
              },
              ...pageProperties,
              ...countOnlyProperty,
              ...detailProperty,
              ...fieldsProperty,
              includeIndirect: { type: "boolean", description: "If this paramter is set to true, indirect group memberships are also returned. Defaults to false." }
            },
            required: ["adGroupId"]
          }
        },

        {
          name: "list_ad_groups_by_org_unit",
          description: "List all Active Directory groups contained within a specific organizational unit (OU). Returns a paged list of AD groups scoped to the given OU GUID. Use list_org_units to find the OU GUID first. Compact by default: comment and single-valued columns are dropped, both named in meta; detail:true returns the full record.",
          inputSchema: {
            type: "object",
            properties: {
              orgUnitId: {
                type: "string",
                description: "GUID of the organizational unit whose AD groups to list."
              },
              SearchQuery: {
                type: "string",
                description: "Filter results by matching against Name, SID, Domain, Comment, Type, or GUID."
              },
              OrderBy: {
                type: "string",
                description: "Sort results by property name and direction (e.g. 'Name asc')."
              },
              ...pageProperties,
              ...countOnlyProperty,
              ...detailProperty,
              ...fieldsProperty,
              includeSubOrgUnit: { type: "boolean", description: "If this paramter is set to true, sub organization units are also queried. Defaults to false." }
            },
            required: ["orgUnitId"]
          }
        },

        // ── AD Objects ────────────────────────────────────────────────────
        {
          name: "list_ad_objects",
          description: "List all Active Directory objects (both users and groups) synchronized into baramundi. Returns a paged list of AD objects with their GUIDs, names, domains, and types. Use this when you need a combined view of AD users and groups. Compact by default: comment and single-valued columns are dropped, both named in meta; detail:true returns the full record.",
          inputSchema: {
            type: "object",
            properties: {
              SearchQuery: {
                type: "string",
                description: "Filter results by matching against Name, SID, Domain, Comment, Type, or GUID."
              },
              OrderBy: {
                type: "string",
                description: "Sort results by property name and direction (e.g. 'Name asc')."
              },
              ...pageProperties,
              ...countOnlyProperty,
              ...detailProperty,
              ...fieldsProperty,
            },
            required: []
          }
        },

        {
          name: "get_ad_object",
          description: "Get detailed information for a specific Active Directory object (user or group) by its GUID. Returns the AD object name, domain, SID, type, and related attributes. Use list_ad_objects to discover object GUIDs.",
          inputSchema: {
            type: "object",
            properties: {
              id: {
                type: "string",
                description: "GUID of the AD object to retrieve."
              }
            },
            required: ["id"]
          }
        },

        {
          name: "list_ad_object_memberships",
          description: "List all Active Directory groups that a specific AD object (user or group) is a member of. Returns a paged list of AD group memberships for the given object GUID. Useful for auditing group membership and access rights.",
          inputSchema: {
            type: "object",
            properties: {
              id: {
                type: "string",
                description: "GUID of the AD object whose group memberships to retrieve."
              },
              ...pageProperties,
              ...countOnlyProperty,
              includeIndirect: { type: "boolean", description: "If this paramter is set to true, indirect group memberships are also returned. Defaults to false." }
            },
            required: ["id"]
          }
        },

        {
          name: "list_ad_objects_by_group",
          description: "List all Active Directory objects (users and groups) that are direct members of a specific AD group. Returns a paged list of AD objects for the given group GUID. Use get_ad_group to find the group GUID first. Compact by default: comment and single-valued columns are dropped, both named in meta; detail:true returns the full record.",
          inputSchema: {
            type: "object",
            properties: {
              adGroupId: {
                type: "string",
                description: "GUID of the AD group whose member objects to list."
              },
              SearchQuery: {
                type: "string",
                description: "Filter results by matching against Name, SID, Domain, Comment, Type, or GUID."
              },
              ...pageProperties,
              ...countOnlyProperty,
              ...detailProperty,
              ...fieldsProperty,
              includeIndirect: { type: "boolean", description: "If this paramter is set to true, indirect group memberships are also returned. Defaults to false." }
            },
            required: ["adGroupId"]
          }
        },

        {
          name: "list_ad_objects_by_org_unit",
          description: "List all Active Directory objects (users and groups) contained within a specific organizational unit. Returns a paged list of AD objects scoped to the given OU GUID. Use list_org_units to find the OU GUID first. Compact by default: comment and single-valued columns are dropped, both named in meta; detail:true returns the full record.",
          inputSchema: {
            type: "object",
            properties: {
              orgUnitId: {
                type: "string",
                description: "GUID of the organizational unit whose AD objects to list."
              },
              SearchQuery: {
                type: "string",
                description: "Filter results by matching against Name, SID, Domain, Comment, Type, or GUID."
              },
              ...pageProperties,
              ...countOnlyProperty,
              ...detailProperty,
              ...fieldsProperty,
              includeSubOrgUnit: { type: "boolean", description: "If this paramter is set to true, sub orginzation units are also queried. Defaults to false." }
            },
            required: ["orgUnitId"]
          }
        },

        // ── AD Users ──────────────────────────────────────────────────────
        {
          name: "list_ad_users",
          description: "List all Active Directory users synchronized into baramundi Management Suite. Returns a paged list of AD users with their GUIDs, names, domains, SIDs, and logon names. Use this to browse available AD users before querying specific ones. Compact by default: comment and single-valued columns are dropped, both named in meta; detail:true returns the full record.",
          inputSchema: {
            type: "object",
            properties: {
              SearchQuery: {
                type: "string",
                description: "Filter results by matching against Name, SID, Domain, Comment, LogonName, or GUID in Active Directory."
              },
              OrderBy: {
                type: "string",
                description: "Sort results by property name and direction. Possible values: Name, SID, Domain, LogonName (e.g. 'Name asc')."
              },
              ...pageProperties,
              ...countOnlyProperty,
              ...detailProperty,
              ...fieldsProperty,
            },
            required: []
          }
        },

        {
          name: "get_ad_user",
          description: "Get detailed information for a specific Active Directory user by their GUID. Returns the AD user name, domain, SID, logon name, email, and other synchronized attributes. Use list_ad_users to discover user GUIDs.",
          inputSchema: {
            type: "object",
            properties: {
              id: {
                type: "string",
                description: "GUID of the AD user to retrieve."
              }
            },
            required: ["id"]
          }
        },

        {
          name: "list_ad_users_by_group",
          description: "List all Active Directory users who are direct members of a specific AD group. Returns a paged list of AD users belonging to the given group GUID. Use list_ad_groups or get_ad_group to find the group GUID first. Compact by default: comment and single-valued columns are dropped, both named in meta; detail:true returns the full record.",
          inputSchema: {
            type: "object",
            properties: {
              adGroupId: {
                type: "string",
                description: "GUID of the AD group whose member users to list."
              },
              SearchQuery: {
                type: "string",
                description: "Filter results by matching against Name, SID, Domain, Comment, LogonName, or GUID."
              },
              OrderBy: {
                type: "string",
                description: "Sort results by property name and direction (e.g. 'Name asc')."
              },
              ...pageProperties,
              ...countOnlyProperty,
              ...detailProperty,
              ...fieldsProperty,
              includeIndirect: { type: "boolean", description: "If this paramter is set to true, indirect group memberships are also returned. Defaults to false." }
            },
            required: ["adGroupId"]
          }
        },

        {
          name: "list_ad_users_by_org_unit",
          description: "List all Active Directory users contained within a specific organizational unit. Returns a paged list of AD users scoped to the given OU GUID. Use list_org_units to discover the OU GUID first. Compact by default: comment and single-valued columns are dropped, both named in meta; detail:true returns the full record.",
          inputSchema: {
            type: "object",
            properties: {
              orgUnitId: {
                type: "string",
                description: "GUID of the organizational unit whose AD users to list."
              },
              SearchQuery: {
                type: "string",
                description: "Filter results by matching against Name, SID, Domain, Comment, LogonName, or GUID."
              },
              OrderBy: {
                type: "string",
                description: "Sort results by property name and direction (e.g. 'Name asc')."
              },
              ...pageProperties,
              ...countOnlyProperty,
              ...detailProperty,
              ...fieldsProperty,
              includeSubOrgUnit: { type: "boolean", description: "If this paramter is set to true, sub organizational units are also queried. Defaults to false." }
            },
            required: ["orgUnitId"]
          }
        },

        // ── Org Units ─────────────────────────────────────────────────────
        {
          name: "list_org_units",
          description: "List all Active Directory organizational units (OUs) synchronized into baramundi Management Suite. Returns a paged list of OUs with their GUIDs, names, distinguished names, and domains. Use this to browse the AD OU hierarchy. Compact by default: comment is omitted and named in meta.dropped — it is ADSync provenance text whose directory position is already in parent/parentId. Use detail:true for the raw record, fields:[..] to pick columns, countOnly:true for the count alone.",
          inputSchema: {
            type: "object",
            properties: {
              SearchQuery: {
                type: "string",
                description: "Filter results by matching against Name, Domain, DistinguishedName, or GUID."
              },
              OrderBy: {
                type: "string",
                description: "Sort results by property name and direction (e.g. 'Name asc')."
              },
              ...pageProperties,
              ...countOnlyProperty,
              ...detailProperty,
              ...fieldsProperty,
              Name: { type: "string", description: "Filters result by matching the exact value against Name." }
            },
            required: []
          }
        },

        {
          name: "get_org_unit",
          description: "Get detailed information for a specific Active Directory organizational unit by its GUID. Returns the OU name, domain, distinguished name, and GUID. Use list_org_units to discover OU GUIDs.",
          inputSchema: {
            type: "object",
            properties: {
              id: {
                type: "string",
                description: "GUID of the organizational unit to retrieve."
              }
            },
            required: ["id"]
          }
        },

        {
          name: "list_org_units_by_org_unit",
          description: "List all child organizational units (OUs) directly contained within a specific parent OU. Returns a paged list of sub-OUs for the given parent OU GUID. Use list_org_units to find the parent OU GUID first.",
          inputSchema: {
            type: "object",
            properties: {
              orgUnitId: {
                type: "string",
                description: "GUID of the parent organizational unit whose child OUs to list."
              },
              SearchQuery: {
                type: "string",
                description: "Filter results by matching against Name, Domain, DistinguishedName, or GUID."
              },
              OrderBy: {
                type: "string",
                description: "Sort results by property name and direction (e.g. 'Name asc')."
              },
              ...pageProperties,
              ...countOnlyProperty,
              Name: { type: "string", description: "Filters result by matching the exact value against Name." },
              includeSubOrgUnits: { type: "boolean", description: "If true, also returns organizational units nested below the given one (default: false)." }
            },
            required: ["orgUnitId"]
          }
        }

  ];

  // ── OPT-4: drop the redundant ldapPath echo out of `comment` ────────────────
  //
  // ADSync writes `comment` as 'Automatically created/updated by ADSync from
  // LDAP://<ldapPath> on <date>' -- restating the row's own `ldapPath` field
  // verbatim. Measured live, full-estate pull: 100% of rows on
  // list_ad_objects (60/60), list_ad_groups (52/52) and list_ad_users (8/8)
  // carry the exact match, 0 misses. -12.7% on a full-estate pull.
  //
  // Only an EXACT match of 'LDAP://' + this row's own ldapPath is touched --
  // never a fuzzy one, so a hand-edited comment, or one naming a different
  // path, is left alone. `comment`'s only other content is the sync date,
  // which has no field of its own, so the match is replaced with a short
  // marker rather than the whole comment being dropped.
  const LDAP_PATH_MARKER = "{ldapPath}";

  function stripRedundantLdapPath(row: Row): Row {
    const comment = row.comment;
    const ldapPath = row.ldapPath;
    if (typeof comment !== "string" || typeof ldapPath !== "string" || ldapPath.length === 0) {
      return row;
    }
    const needle = `LDAP://${ldapPath}`;
    if (!comment.includes(needle)) {
      return row;
    }
    return { ...row, comment: comment.split(needle).join(LDAP_PATH_MARKER) };
  }

  /**
   * Applies `stripRedundantLdapPath` across an envelope's rows and names the
   * fold in `meta` — nothing is dropped without saying so, even though this is
   * a substring edit rather than a column drop. Rows without a matching
   * comment/ldapPath pair (org units, memberships) pass through untouched, and
   * no `meta` is added when nothing on the page actually matched.
   */
  function shapeAdComments<T extends { data?: unknown }>(payload: T): T {
    if (!payload || !Array.isArray(payload.data)) {
      return payload;
    }
    let stripped = 0;
    const data = (payload.data as Row[]).map((row) => {
      const next = stripRedundantLdapPath(row);
      if (next !== row) {stripped++;}
      return next;
    });
    if (stripped === 0) {
      return payload;
    }
    return {
      ...payload,
      data,
      meta: {
        commentLdapPathElided: stripped,
        hint:
          `comment had 'LDAP://' + this row's own ldapPath replaced with '${LDAP_PATH_MARKER}' on ` +
          `${stripped} row(s) — ldapPath already carries the same value as a top-level field.`,
      },
    };
  }

  /**
   * The AD list path: elide, then project.
   *
   * Order matters and the two steps are separate concerns. `shapeAdComments`
   * (OPT-4) is a lossless substring fold that has been the contract for these
   * tools since it shipped and is named in every one of their descriptions, so
   * it runs on BOTH paths — `detail:true` therefore returns exactly what it
   * returned before this projection existed, rather than silently becoming a
   * third shape. `shapeAdRows` then drops the provenance column and the
   * single-valued ones on the compact path only, and `mergeShapeMeta` composes
   * its `meta` with the elision's rather than overwriting it.
   */
  function shapeAdList<T extends { data?: unknown }>(
    payload: T, args: Record<string, unknown> | undefined
  ): unknown {
    const elided = shapeAdComments(payload);
    const full = args?.detail === true;
    return shapeAdRows(elided as unknown as ListEnvelope, {
      full,
      fields: args?.fields as string[] | undefined,
      args,
    });
  }

  const catalogue = defineToolCatalogue({ tools: TOOLS, write: [] });

  // ── ListToolsRequestSchema handler ────────────────────────────────────────

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: catalogue.listTools() };
  });

  // ── CallToolRequestSchema handler ─────────────────────────────────────────

  // ── Argument-validation pre-pass (runs before getBconnect) ─────────────────
  function validateToolArguments(name: string, args: Record<string, unknown> | undefined): void {
    switch (name) {
      // AD Groups
      case "list_ad_groups":
        validateOrThrow(args, ActiveDirectoryRules.listAdGroups()); return;
      case "get_ad_group":
        validateOrThrow(args, ActiveDirectoryRules.getAdGroup()); return;
      case "list_ad_subgroups":
        validateOrThrow(args, ActiveDirectoryRules.listAdSubgroups()); return;
      case "list_ad_groups_by_org_unit":
        validateOrThrow(args, ActiveDirectoryRules.listAdGroupsByOrgUnit()); return;
      // AD Objects
      case "list_ad_objects":
        validateOrThrow(args, ActiveDirectoryRules.listAdObjects()); return;
      case "get_ad_object":
        validateOrThrow(args, ActiveDirectoryRules.getAdObject()); return;
      case "list_ad_object_memberships":
        validateOrThrow(args, ActiveDirectoryRules.listAdObjectMemberships()); return;
      case "list_ad_objects_by_group":
        validateOrThrow(args, ActiveDirectoryRules.listAdObjectsByGroup()); return;
      case "list_ad_objects_by_org_unit":
        validateOrThrow(args, ActiveDirectoryRules.listAdObjectsByOrgUnit()); return;
      // AD Users
      case "list_ad_users":
        validateOrThrow(args, ActiveDirectoryRules.listAdUsers()); return;
      case "get_ad_user":
        validateOrThrow(args, ActiveDirectoryRules.getAdUser()); return;
      case "list_ad_users_by_group":
        validateOrThrow(args, ActiveDirectoryRules.listAdUsersByGroup()); return;
      case "list_ad_users_by_org_unit":
        validateOrThrow(args, ActiveDirectoryRules.listAdUsersByOrgUnit()); return;
      // Org Units
      case "list_org_units":
        validateOrThrow(args, ActiveDirectoryRules.listOrgUnits()); return;
      case "get_org_unit":
        validateOrThrow(args, ActiveDirectoryRules.getOrgUnit()); return;
      case "list_org_units_by_org_unit":
        validateOrThrow(args, ActiveDirectoryRules.listOrgUnitsByOrgUnit()); return;
      // Unknown tool names are not validated here; dispatch handles MethodNotFound.
    }
  }

  // ── Client lifetime (upstream finding R3) ─────────────────────────────────
  // Built lazily on first tool call, but held HERE, in createServer() scope,
  // not inside the tool-call handler where this used to live. A client
  // constructed per call rebuilt everything stateful it owned on every call,
  // which is why rate limiting never limited (B8) and why the response cache
  // could not have worked even once wired up (B7). The provider is per
  // session and re-keys itself if the resolved credentials change, so a
  // longer-lived client cannot leak across differently-credentialed callers.
  // See packages/mcp-core/src/client-provider.ts.
  const getBconnect = createClientProvider<BConnectClient>({
    // Enables the optional per-server credential convention
    // (BCONNECT_API_KEY__ACTIVEDIRECTORY); with no such variable set this
    // changes nothing. See mcp-core/server-scoped-credentials.ts.
    serverName: "bconnect-activedirectory-mcp",
    factory: (config) => new BConnectClient(config),
    credentials,
    defaultBaseUrl: "https://bms-server/bconnect",
    onMissingCredentials: () => {
      throw new BareMcpError(
        ErrorCode.InternalError,
        "Either BCONNECT_API_KEY or both BCONNECT_USERNAME and BCONNECT_PASSWORD are required"
      );
    },
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    // Validate arguments first — pure, no side effects, fails fast on bad input.
    validateToolArguments(name, args);

    // D6 — refuse an argument key this tool's schema does not declare.
    // validateParameters() iterates over RULES, so a key with no rule was never
    // examined by anything; bConnect then answers 200 and silently ignores an
    // unrecognised query key. Measured live, one transposed character in a filter
    // name returned 37,571 rows instead of 1, labelled as a filtered result.
    catalogue.assertKnownParameters(name, args);
    // SEC-0 — every id-shaped argument must be a single, traversal-free path
    // segment. This lived in 3 of 13 servers; it is on the catalogue now so a
    // server cannot be built without it.
    catalogue.assertSafePathParameters(name, args);

    // Write gate. This server declares no writes, so it never refuses today —
    // it is here so that adding one cannot skip the gate.
    const denied = catalogue.gateWriteTool(name);
    if (denied) {
      return denied;
    }

    try {
      const bconnect = getBconnect();
      const ad = bconnect.activeDirectory;

      // Dispatch — arguments already validated by validateToolArguments above.
      switch (name) {

        // ── AD Groups ─────────────────────────────────────────────────────
        case "list_ad_groups": {
          if (isCountOnlyRequest(args)) {
            const count = await fetchCount((p) => ad.getADGroups(p as never), args);
            return toolTextResult(serializeToolResult(count));
          }
          const result = await ad.getADGroups(apiParams(args) as never);
          return { content: [{ type: "text", text: serializeToolResult(shapeAdList(result, args)) }] };
        }

        case "get_ad_group": {
          const result = await ad.getADGroup(args!.id as string);
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        case "list_ad_subgroups": {
          if (isCountOnlyRequest(args)) {
            const { adGroupId: _scope, ...params } = args as Record<string, unknown>;
            const count = await fetchCount((p) => ad.getADGroupsByAdGroup(_scope as string, p as never), params);
            return toolTextResult(serializeToolResult(count));
          }
          const result = await ad.getADGroupsByAdGroup(args!.adGroupId as string, apiParams(args) as never);
          return { content: [{ type: "text", text: serializeToolResult(shapeAdList(result, args)) }] };
        }

        case "list_ad_groups_by_org_unit": {
          if (isCountOnlyRequest(args)) {
            const { orgUnitId: _scope, ...params } = args as Record<string, unknown>;
            const count = await fetchCount((p) => ad.getADGroupsByOrgUnit(_scope as string, p as never), params);
            return toolTextResult(serializeToolResult(count));
          }
          const result = await ad.getADGroupsByOrgUnit(args!.orgUnitId as string, apiParams(args) as never);
          return { content: [{ type: "text", text: serializeToolResult(shapeAdList(result, args)) }] };
        }

        // ── AD Objects ────────────────────────────────────────────────────
        case "list_ad_objects": {
          if (isCountOnlyRequest(args)) {
            const count = await fetchCount((p) => ad.getADObjects(p as never), args);
            return toolTextResult(serializeToolResult(count));
          }
          const result = await ad.getADObjects(apiParams(args) as never);
          return { content: [{ type: "text", text: serializeToolResult(shapeAdList(result, args)) }] };
        }

        case "get_ad_object": {
          const result = await ad.getADObject(args!.id as string);
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        case "list_ad_object_memberships": {
          if (isCountOnlyRequest(args)) {
            const { id: _scope, ...params } = args as Record<string, unknown>;
            const count = await fetchCount((p) => ad.getADObjectMemberships(_scope as string, p as never), params);
            return toolTextResult(serializeToolResult(count));
          }
          const result = await ad.getADObjectMemberships(args!.id as string, apiParams(args) as never);
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        case "list_ad_objects_by_group": {
          if (isCountOnlyRequest(args)) {
            const { adGroupId: _scope, ...params } = args as Record<string, unknown>;
            const count = await fetchCount((p) => ad.getADObjectsByAdGroup(_scope as string, p as never), params);
            return toolTextResult(serializeToolResult(count));
          }
          const result = await ad.getADObjectsByAdGroup(args!.adGroupId as string, apiParams(args) as never);
          return { content: [{ type: "text", text: serializeToolResult(shapeAdList(result, args)) }] };
        }

        case "list_ad_objects_by_org_unit": {
          if (isCountOnlyRequest(args)) {
            const { orgUnitId: _scope, ...params } = args as Record<string, unknown>;
            const count = await fetchCount((p) => ad.getADObjectsByOrgUnit(_scope as string, p as never), params);
            return toolTextResult(serializeToolResult(count));
          }
          const result = await ad.getADObjectsByOrgUnit(args!.orgUnitId as string, apiParams(args) as never);
          return { content: [{ type: "text", text: serializeToolResult(shapeAdList(result, args)) }] };
        }

        // ── AD Users ──────────────────────────────────────────────────────
        case "list_ad_users": {
          if (isCountOnlyRequest(args)) {
            const count = await fetchCount((p) => ad.getADUsers(p as never), args);
            return toolTextResult(serializeToolResult(count));
          }
          const result = await ad.getADUsers(apiParams(args) as never);
          return { content: [{ type: "text", text: serializeToolResult(shapeAdList(result, args)) }] };
        }

        case "get_ad_user": {
          const result = await ad.getADUser(args!.id as string);
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        case "list_ad_users_by_group": {
          if (isCountOnlyRequest(args)) {
            const { adGroupId: _scope, ...params } = args as Record<string, unknown>;
            const count = await fetchCount((p) => ad.getADUsersByGroup(_scope as string, p as never), params);
            return toolTextResult(serializeToolResult(count));
          }
          const result = await ad.getADUsersByGroup(args!.adGroupId as string, apiParams(args) as never);
          return { content: [{ type: "text", text: serializeToolResult(shapeAdList(result, args)) }] };
        }

        case "list_ad_users_by_org_unit": {
          if (isCountOnlyRequest(args)) {
            const { orgUnitId: _scope, ...params } = args as Record<string, unknown>;
            const count = await fetchCount((p) => ad.getADUsersByOrgUnit(_scope as string, p as never), params);
            return toolTextResult(serializeToolResult(count));
          }
          const result = await ad.getADUsersByOrgUnit(args!.orgUnitId as string, apiParams(args) as never);
          return { content: [{ type: "text", text: serializeToolResult(shapeAdList(result, args)) }] };
        }

        // ── Org Units ─────────────────────────────────────────────────────
        case "list_org_units": {
          if (isCountOnlyRequest(args)) {
            const count = await fetchCount((p) => ad.getOrgUnits(p as never), args);
            return toolTextResult(serializeToolResult(count));
          }
          const result = await ad.getOrgUnits(apiParams(args) as never);
          return toolTextResult(
            serializeToolResult(
              shapeOrgUnits(result as unknown as ListEnvelope, {
                full: args?.detail === true,
                fields: Array.isArray(args?.fields) ? (args.fields as string[]) : undefined,
                args,
              })
            )
          );
        }

        case "get_org_unit": {
          const result = await ad.getOrgUnit(args!.id as string);
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        case "list_org_units_by_org_unit": {
          if (isCountOnlyRequest(args)) {
            const { orgUnitId: _scope, ...params } = args as Record<string, unknown>;
            const count = await fetchCount((p) => ad.getOrgUnitsByOrgUnit(_scope as string, p as never), params);
            return toolTextResult(serializeToolResult(count));
          }
          const result = await ad.getOrgUnitsByOrgUnit(args!.orgUnitId as string, apiParams(args) as never);
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        default:
          throw new BareMcpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
      }
    } catch (error: unknown) {
      // INT-53 — one error channel. See packages/mcp-core/src/tool-error.ts.
      return handleToolError(error);
    }
  });

  // Difference 3 — hand the memoised provider back so runServer's startup
  // connectivity check probes the very client tool dispatch will use.
  return { server, getClient: getBconnect };
}

// ─── Entry point (OPT-32) ────────────────────────────────────────────────────
//
// This server used to hand-write ~85 lines of bootstrap. Every line of it is
// now in `runServer()`, which resolves the six ways the thirteen copies had
// drifted. Two consequences are visible from here and are deliberate:
//
//   - BCONNECT_BASE_URL has NO default any more. The old
//     `|| "https://bms.example.com:443/bconnect"` fallback sent real
//     credentials to a host the vendor does not control whenever the variable
//     was unset. Absent base URL is now exit 1, before any client is built.
//   - The startup connectivity check probes `getClient()` above — the client
//     tool dispatch uses — not a throwaway built from a second reading of the
//     environment. That is why `createServer` returns it.
//
// `express` is injected because mcp-core does not depend on it: this package
// pins ^4.21.0 while the workspace root hoists 5.x.
if (shouldAutoStart()) {
  void runServer({
    name: "bconnect-activedirectory-mcp",
    createServer,
    http: { express },
  }).catch((error) => {
    console.error(`Fatal error: ${describeConnectionFailure(error)}`);
    process.exit(1);
  });
}
