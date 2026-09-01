/**
 * bConnect Groups Module
 *
 * Provides group-scoped endpoint queries:
 * list {EndpointType} by {GroupType}
 *
 * All 27 endpoints follow the same GET pattern:
 *   GET /v2.0/{GroupType}/{groupId}/{EndpointType}?SearchQuery=&Page=&PageSize=&OrderBy=
 */

import type { AxiosInstance } from "axios";
import type { paths } from "../generated/endpoints-types.js";
import { readSubResource, notOverloaded404 } from "@bconnect/mcp-core";

// ── Response type aliases ──────────────────────────────────────────────────

// Logical Group response types
type EndpointsByLogicalGroup         = paths["/v2.0/LogicalGroups/{logicalGroupId}/Endpoints"]["get"]["responses"]["200"]["content"]["application/json"];
type AndroidEndpointsByLogicalGroup  = paths["/v2.0/LogicalGroups/{logicalGroupId}/AndroidEndpoints"]["get"]["responses"]["200"]["content"]["application/json"];
type IosEndpointsByLogicalGroup      = paths["/v2.0/LogicalGroups/{logicalGroupId}/IosEndpoints"]["get"]["responses"]["200"]["content"]["application/json"];
type LinuxEndpointsByLogicalGroup    = paths["/v2.0/LogicalGroups/{logicalGroupId}/LinuxEndpoints"]["get"]["responses"]["200"]["content"]["application/json"];
type MacEndpointsByLogicalGroup      = paths["/v2.0/LogicalGroups/{logicalGroupId}/MacEndpoints"]["get"]["responses"]["200"]["content"]["application/json"];
type NetworkEndpointsByLogicalGroup  = paths["/v2.0/LogicalGroups/{logicalGroupId}/NetworkEndpoints"]["get"]["responses"]["200"]["content"]["application/json"];
type WindowsEndpointsByLogicalGroup  = paths["/v2.0/LogicalGroups/{logicalGroupId}/WindowsEndpoints"]["get"]["responses"]["200"]["content"]["application/json"];
type LogicalGroupsByLogicalGroup     = paths["/v2.0/LogicalGroups/{logicalGroupId}/LogicalGroups"]["get"]["responses"]["200"]["content"]["application/json"];

// Static Group response types
type EndpointsByStaticGroup          = paths["/v2.0/StaticGroups/{staticGroupId}/Endpoints"]["get"]["responses"]["200"]["content"]["application/json"];
type AndroidEndpointsByStaticGroup   = paths["/v2.0/StaticGroups/{staticGroupId}/AndroidEndpoints"]["get"]["responses"]["200"]["content"]["application/json"];
type IosEndpointsByStaticGroup       = paths["/v2.0/StaticGroups/{staticGroupId}/IosEndpoints"]["get"]["responses"]["200"]["content"]["application/json"];
type LinuxEndpointsByStaticGroup     = paths["/v2.0/StaticGroups/{staticGroupId}/LinuxEndpoints"]["get"]["responses"]["200"]["content"]["application/json"];
type MacEndpointsByStaticGroup       = paths["/v2.0/StaticGroups/{staticGroupId}/MacEndpoints"]["get"]["responses"]["200"]["content"]["application/json"];
type NetworkEndpointsByStaticGroup   = paths["/v2.0/StaticGroups/{staticGroupId}/NetworkEndpoints"]["get"]["responses"]["200"]["content"]["application/json"];
type WindowsEndpointsByStaticGroup   = paths["/v2.0/StaticGroups/{staticGroupId}/WindowsEndpoints"]["get"]["responses"]["200"]["content"]["application/json"];

// Dynamic Group response types
type EndpointsByDynamicGroup         = paths["/v2.0/DynamicGroups/{dynamicGroupId}/Endpoints"]["get"]["responses"]["200"]["content"]["application/json"];
type WindowsEndpointsByDynamicGroup  = paths["/v2.0/DynamicGroups/{dynamicGroupId}/WindowsEndpoints"]["get"]["responses"]["200"]["content"]["application/json"];

// AD User response types
type EndpointsByADUser               = paths["/v2.0/ADUsers/{adUserId}/Endpoints"]["get"]["responses"]["200"]["content"]["application/json"];
type AndroidEndpointsByADUser        = paths["/v2.0/ADUsers/{adUserId}/AndroidEndpoints"]["get"]["responses"]["200"]["content"]["application/json"];
type IosEndpointsByADUser            = paths["/v2.0/ADUsers/{adUserId}/IosEndpoints"]["get"]["responses"]["200"]["content"]["application/json"];
type LinuxEndpointsByADUser          = paths["/v2.0/ADUsers/{adUserId}/LinuxEndpoints"]["get"]["responses"]["200"]["content"]["application/json"];
type MacEndpointsByADUser            = paths["/v2.0/ADUsers/{adUserId}/MacEndpoints"]["get"]["responses"]["200"]["content"]["application/json"];
type WindowsEndpointsByADUser        = paths["/v2.0/ADUsers/{adUserId}/WindowsEndpoints"]["get"]["responses"]["200"]["content"]["application/json"];

// Universal Dynamic Group response types
type EndpointsByUDG                  = paths["/v2.0/UniversalDynamicGroups/{universalDynamicGroupId}/Endpoints"]["get"]["responses"]["200"]["content"]["application/json"];
type AndroidEndpointsByUDG           = paths["/v2.0/UniversalDynamicGroups/{universalDynamicGroupId}/AndroidEndpoints"]["get"]["responses"]["200"]["content"]["application/json"];
type IosEndpointsByUDG               = paths["/v2.0/UniversalDynamicGroups/{universalDynamicGroupId}/IosEndpoints"]["get"]["responses"]["200"]["content"]["application/json"];
type LinuxEndpointsByUDG             = paths["/v2.0/UniversalDynamicGroups/{universalDynamicGroupId}/LinuxEndpoints"]["get"]["responses"]["200"]["content"]["application/json"];
type MacEndpointsByUDG               = paths["/v2.0/UniversalDynamicGroups/{universalDynamicGroupId}/MacEndpoints"]["get"]["responses"]["200"]["content"]["application/json"];
type NetworkEndpointsByUDG           = paths["/v2.0/UniversalDynamicGroups/{universalDynamicGroupId}/NetworkEndpoints"]["get"]["responses"]["200"]["content"]["application/json"];
type WindowsEndpointsByUDG           = paths["/v2.0/UniversalDynamicGroups/{universalDynamicGroupId}/WindowsEndpoints"]["get"]["responses"]["200"]["content"]["application/json"];

// ── Query params ───────────────────────────────────────────────────────────

export interface GroupQueryParams {
  SearchQuery?: string;
  Page?: number;
  PageSize?: number;
  OrderBy?: string;
}

// ── Module ─────────────────────────────────────────────────────────────────

export class GroupsModule {
  private basePath = "/endpoints/v2.0";

  constructor(private client: AxiosInstance) {}

  // ── Logical Group ────────────────────────────────────────────────────────

  async getEndpointsByLogicalGroup(logicalGroupId: string, params?: GroupQueryParams): Promise<EndpointsByLogicalGroup> {
    return readSubResource(
      async () => {
        const response = await this.client.get<EndpointsByLogicalGroup>(`${this.basePath}/LogicalGroups/${logicalGroupId}/Endpoints`, { params });
        return response.data;
      },
      logicalGroupId,
      notOverloaded404(
        "Measured 2026-08-14: 19 of 19 parents answer 200 (13 with totalItems 0, 6 with rows); a well-formed nonexistent id answers 404."
      )
    );
  }

  async getAndroidEndpointsByLogicalGroup(logicalGroupId: string, params?: GroupQueryParams): Promise<AndroidEndpointsByLogicalGroup> {
    return readSubResource(
      async () => {
        const response = await this.client.get<AndroidEndpointsByLogicalGroup>(`${this.basePath}/LogicalGroups/${logicalGroupId}/AndroidEndpoints`, { params });
        return response.data;
      },
      logicalGroupId,
      notOverloaded404(
        "Measured 2026-08-14: 19 of 19 parents answer 200 (19 with totalItems 0); a well-formed nonexistent id answers 404."
      )
    );
  }

  async getIosEndpointsByLogicalGroup(logicalGroupId: string, params?: GroupQueryParams): Promise<IosEndpointsByLogicalGroup> {
    return readSubResource(
      async () => {
        const response = await this.client.get<IosEndpointsByLogicalGroup>(`${this.basePath}/LogicalGroups/${logicalGroupId}/IosEndpoints`, { params });
        return response.data;
      },
      logicalGroupId,
      notOverloaded404(
        "Measured 2026-08-14: 19 of 19 parents answer 200 (19 with totalItems 0); a well-formed nonexistent id answers 404."
      )
    );
  }

  async getLinuxEndpointsByLogicalGroup(logicalGroupId: string, params?: GroupQueryParams): Promise<LinuxEndpointsByLogicalGroup> {
    return readSubResource(
      async () => {
        const response = await this.client.get<LinuxEndpointsByLogicalGroup>(`${this.basePath}/LogicalGroups/${logicalGroupId}/LinuxEndpoints`, { params });
        return response.data;
      },
      logicalGroupId,
      notOverloaded404(
        "Measured 2026-08-14: 19 of 19 parents answer 200 (18 with totalItems 0, 1 with rows); a well-formed nonexistent id answers 404."
      )
    );
  }

  async getMacEndpointsByLogicalGroup(logicalGroupId: string, params?: GroupQueryParams): Promise<MacEndpointsByLogicalGroup> {
    return readSubResource(
      async () => {
        const response = await this.client.get<MacEndpointsByLogicalGroup>(`${this.basePath}/LogicalGroups/${logicalGroupId}/MacEndpoints`, { params });
        return response.data;
      },
      logicalGroupId,
      notOverloaded404(
        "Measured 2026-08-14: 19 of 19 parents answer 200 (19 with totalItems 0); a well-formed nonexistent id answers 404."
      )
    );
  }

  async getNetworkEndpointsByLogicalGroup(logicalGroupId: string, params?: GroupQueryParams): Promise<NetworkEndpointsByLogicalGroup> {
    return readSubResource(
      async () => {
        const response = await this.client.get<NetworkEndpointsByLogicalGroup>(`${this.basePath}/LogicalGroups/${logicalGroupId}/NetworkEndpoints`, { params });
        return response.data;
      },
      logicalGroupId,
      notOverloaded404(
        "Measured 2026-08-14: 19 of 19 parents answer 200 (18 with totalItems 0, 1 with rows); a well-formed nonexistent id answers 404."
      )
    );
  }

  async getWindowsEndpointsByLogicalGroup(logicalGroupId: string, params?: GroupQueryParams): Promise<WindowsEndpointsByLogicalGroup> {
    return readSubResource(
      async () => {
        const response = await this.client.get<WindowsEndpointsByLogicalGroup>(`${this.basePath}/LogicalGroups/${logicalGroupId}/WindowsEndpoints`, { params });
        return response.data;
      },
      logicalGroupId,
      notOverloaded404(
        "Measured 2026-08-14: 19 of 19 parents answer 200 (15 with totalItems 0, 4 with rows); a well-formed nonexistent id answers 404."
      )
    );
  }

  async getLogicalGroupsByLogicalGroup(logicalGroupId: string, params?: GroupQueryParams): Promise<LogicalGroupsByLogicalGroup> {
    return readSubResource(
      async () => {
        const response = await this.client.get<LogicalGroupsByLogicalGroup>(`${this.basePath}/LogicalGroups/${logicalGroupId}/LogicalGroups`, { params });
        return response.data;
      },
      logicalGroupId,
      notOverloaded404(
        "Measured 2026-08-14: 19 of 19 parents answer 200 (11 with totalItems 0, 8 with rows); a well-formed nonexistent id answers 404."
      )
    );
  }

  // ── Static Group ─────────────────────────────────────────────────────────

  async getEndpointsByStaticGroup(staticGroupId: string, params?: GroupQueryParams): Promise<EndpointsByStaticGroup> {
    const response = await this.client.get<EndpointsByStaticGroup>(`${this.basePath}/StaticGroups/${staticGroupId}/Endpoints`, { params });
    return response.data;
  }

  async getAndroidEndpointsByStaticGroup(staticGroupId: string, params?: GroupQueryParams): Promise<AndroidEndpointsByStaticGroup> {
    return readSubResource(
      async () => {
        const response = await this.client.get<AndroidEndpointsByStaticGroup>(`${this.basePath}/StaticGroups/${staticGroupId}/AndroidEndpoints`, { params });
        return response.data;
      },
      staticGroupId,
      notOverloaded404(
        "Measured 2026-08-14 with a static group id supplied from the bMC console (n=1, the only one available): it answers 200 with totalItems 0, and a well-formed nonexistent id answers 404. n=1 is enough for THIS question — a 200-with-zero is an existence proof that the route expresses empty without a 404 — but it says nothing about any other static group."
      )
    );
  }

  async getIosEndpointsByStaticGroup(staticGroupId: string, params?: GroupQueryParams): Promise<IosEndpointsByStaticGroup> {
    return readSubResource(
      async () => {
        const response = await this.client.get<IosEndpointsByStaticGroup>(`${this.basePath}/StaticGroups/${staticGroupId}/IosEndpoints`, { params });
        return response.data;
      },
      staticGroupId,
      notOverloaded404(
        "Measured 2026-08-14 with a static group id supplied from the bMC console (n=1, the only one available): it answers 200 with totalItems 0, and a well-formed nonexistent id answers 404. n=1 is enough for THIS question — a 200-with-zero is an existence proof that the route expresses empty without a 404 — but it says nothing about any other static group."
      )
    );
  }

  async getLinuxEndpointsByStaticGroup(staticGroupId: string, params?: GroupQueryParams): Promise<LinuxEndpointsByStaticGroup> {
    return readSubResource(
      async () => {
        const response = await this.client.get<LinuxEndpointsByStaticGroup>(`${this.basePath}/StaticGroups/${staticGroupId}/LinuxEndpoints`, { params });
        return response.data;
      },
      staticGroupId,
      notOverloaded404(
        "Measured 2026-08-14 with a static group id supplied from the bMC console (n=1, the only one available): it answers 200 with totalItems 0, and a well-formed nonexistent id answers 404. n=1 is enough for THIS question — a 200-with-zero is an existence proof that the route expresses empty without a 404 — but it says nothing about any other static group."
      )
    );
  }

  async getMacEndpointsByStaticGroup(staticGroupId: string, params?: GroupQueryParams): Promise<MacEndpointsByStaticGroup> {
    return readSubResource(
      async () => {
        const response = await this.client.get<MacEndpointsByStaticGroup>(`${this.basePath}/StaticGroups/${staticGroupId}/MacEndpoints`, { params });
        return response.data;
      },
      staticGroupId,
      notOverloaded404(
        "Measured 2026-08-14 with a static group id supplied from the bMC console (n=1, the only one available): it answers 200 with totalItems 0, and a well-formed nonexistent id answers 404. n=1 is enough for THIS question — a 200-with-zero is an existence proof that the route expresses empty without a 404 — but it says nothing about any other static group."
      )
    );
  }

  async getNetworkEndpointsByStaticGroup(staticGroupId: string, params?: GroupQueryParams): Promise<NetworkEndpointsByStaticGroup> {
    return readSubResource(
      async () => {
        const response = await this.client.get<NetworkEndpointsByStaticGroup>(`${this.basePath}/StaticGroups/${staticGroupId}/NetworkEndpoints`, { params });
        return response.data;
      },
      staticGroupId,
      notOverloaded404(
        "Measured 2026-08-14 with a static group id supplied from the bMC console (n=1, the only one available): it answers 200 with totalItems 0, and a well-formed nonexistent id answers 404. n=1 is enough for THIS question — a 200-with-zero is an existence proof that the route expresses empty without a 404 — but it says nothing about any other static group."
      )
    );
  }

  async getWindowsEndpointsByStaticGroup(staticGroupId: string, params?: GroupQueryParams): Promise<WindowsEndpointsByStaticGroup> {
    const response = await this.client.get<WindowsEndpointsByStaticGroup>(`${this.basePath}/StaticGroups/${staticGroupId}/WindowsEndpoints`, { params });
    return response.data;
  }

  // ── Dynamic Group ────────────────────────────────────────────────────────

  async getEndpointsByDynamicGroup(dynamicGroupId: string, params?: GroupQueryParams): Promise<EndpointsByDynamicGroup> {
    const response = await this.client.get<EndpointsByDynamicGroup>(`${this.basePath}/DynamicGroups/${dynamicGroupId}/Endpoints`, { params });
    return response.data;
  }

  async getWindowsEndpointsByDynamicGroup(dynamicGroupId: string, params?: GroupQueryParams): Promise<WindowsEndpointsByDynamicGroup> {
    const response = await this.client.get<WindowsEndpointsByDynamicGroup>(`${this.basePath}/DynamicGroups/${dynamicGroupId}/WindowsEndpoints`, { params });
    return response.data;
  }

  // ── Universal Dynamic Group ───────────────────────────────────────────────

  async getEndpointsByUDG(universalDynamicGroupId: string, params?: GroupQueryParams): Promise<EndpointsByUDG> {
    return readSubResource(
      async () => {
        const response = await this.client.get<EndpointsByUDG>(`${this.basePath}/UniversalDynamicGroups/${universalDynamicGroupId}/Endpoints`, { params });
        return response.data;
      },
      universalDynamicGroupId,
      notOverloaded404(
        "Measured 2026-08-14: 55 of 55 parents answer 200 (15 with totalItems 0, 40 with rows); a well-formed nonexistent id answers 404."
      )
    );
  }

  async getAndroidEndpointsByUDG(universalDynamicGroupId: string, params?: GroupQueryParams): Promise<AndroidEndpointsByUDG> {
    return readSubResource(
      async () => {
        const response = await this.client.get<AndroidEndpointsByUDG>(`${this.basePath}/UniversalDynamicGroups/${universalDynamicGroupId}/AndroidEndpoints`, { params });
        return response.data;
      },
      universalDynamicGroupId,
      notOverloaded404(
        "Measured 2026-08-14: 55 of 55 parents answer 200 (55 with totalItems 0); a well-formed nonexistent id answers 404."
      )
    );
  }

  async getIosEndpointsByUDG(universalDynamicGroupId: string, params?: GroupQueryParams): Promise<IosEndpointsByUDG> {
    return readSubResource(
      async () => {
        const response = await this.client.get<IosEndpointsByUDG>(`${this.basePath}/UniversalDynamicGroups/${universalDynamicGroupId}/IosEndpoints`, { params });
        return response.data;
      },
      universalDynamicGroupId,
      notOverloaded404(
        "Measured 2026-08-14: 55 of 55 parents answer 200 (55 with totalItems 0); a well-formed nonexistent id answers 404."
      )
    );
  }

  async getLinuxEndpointsByUDG(universalDynamicGroupId: string, params?: GroupQueryParams): Promise<LinuxEndpointsByUDG> {
    return readSubResource(
      async () => {
        const response = await this.client.get<LinuxEndpointsByUDG>(`${this.basePath}/UniversalDynamicGroups/${universalDynamicGroupId}/LinuxEndpoints`, { params });
        return response.data;
      },
      universalDynamicGroupId,
      notOverloaded404(
        "Measured 2026-08-14: 55 of 55 parents answer 200 (46 with totalItems 0, 9 with rows); a well-formed nonexistent id answers 404."
      )
    );
  }

  async getMacEndpointsByUDG(universalDynamicGroupId: string, params?: GroupQueryParams): Promise<MacEndpointsByUDG> {
    return readSubResource(
      async () => {
        const response = await this.client.get<MacEndpointsByUDG>(`${this.basePath}/UniversalDynamicGroups/${universalDynamicGroupId}/MacEndpoints`, { params });
        return response.data;
      },
      universalDynamicGroupId,
      notOverloaded404(
        "Measured 2026-08-14: 55 of 55 parents answer 200 (55 with totalItems 0); a well-formed nonexistent id answers 404."
      )
    );
  }

  async getNetworkEndpointsByUDG(universalDynamicGroupId: string, params?: GroupQueryParams): Promise<NetworkEndpointsByUDG> {
    return readSubResource(
      async () => {
        const response = await this.client.get<NetworkEndpointsByUDG>(`${this.basePath}/UniversalDynamicGroups/${universalDynamicGroupId}/NetworkEndpoints`, { params });
        return response.data;
      },
      universalDynamicGroupId,
      notOverloaded404(
        "Measured 2026-08-14: 55 of 55 parents answer 200 (48 with totalItems 0, 7 with rows); a well-formed nonexistent id answers 404."
      )
    );
  }

  async getWindowsEndpointsByUDG(universalDynamicGroupId: string, params?: GroupQueryParams): Promise<WindowsEndpointsByUDG> {
    return readSubResource(
      async () => {
        const response = await this.client.get<WindowsEndpointsByUDG>(`${this.basePath}/UniversalDynamicGroups/${universalDynamicGroupId}/WindowsEndpoints`, { params });
        return response.data;
      },
      universalDynamicGroupId,
      notOverloaded404(
        "Measured 2026-08-14: 55 of 55 parents answer 200 (16 with totalItems 0, 39 with rows); a well-formed nonexistent id answers 404."
      )
    );
  }

  // ── AD User ───────────────────────────────────────────────────────────────

  async getEndpointsByADUser(adUserId: string, params?: GroupQueryParams): Promise<EndpointsByADUser> {
    return readSubResource(
      async () => {
        const response = await this.client.get<EndpointsByADUser>(`${this.basePath}/ADUsers/${adUserId}/Endpoints`, { params });
        return response.data;
      },
      adUserId,
      notOverloaded404(
        "Measured 2026-08-14: 8 of 8 parents answer 200 (8 with totalItems 0); a well-formed nonexistent id answers 404."
      )
    );
  }

  async getAndroidEndpointsByADUser(adUserId: string, params?: GroupQueryParams): Promise<AndroidEndpointsByADUser> {
    return readSubResource(
      async () => {
        const response = await this.client.get<AndroidEndpointsByADUser>(`${this.basePath}/ADUsers/${adUserId}/AndroidEndpoints`, { params });
        return response.data;
      },
      adUserId,
      notOverloaded404(
        "Measured 2026-08-14: 8 of 8 parents answer 200 (8 with totalItems 0); a well-formed nonexistent id answers 404."
      )
    );
  }

  async getIosEndpointsByADUser(adUserId: string, params?: GroupQueryParams): Promise<IosEndpointsByADUser> {
    return readSubResource(
      async () => {
        const response = await this.client.get<IosEndpointsByADUser>(`${this.basePath}/ADUsers/${adUserId}/IosEndpoints`, { params });
        return response.data;
      },
      adUserId,
      notOverloaded404(
        "Measured 2026-08-14: 8 of 8 parents answer 200 (8 with totalItems 0); a well-formed nonexistent id answers 404."
      )
    );
  }

  async getLinuxEndpointsByADUser(adUserId: string, params?: GroupQueryParams): Promise<LinuxEndpointsByADUser> {
    return readSubResource(
      async () => {
        const response = await this.client.get<LinuxEndpointsByADUser>(`${this.basePath}/ADUsers/${adUserId}/LinuxEndpoints`, { params });
        return response.data;
      },
      adUserId,
      notOverloaded404(
        "Measured 2026-08-14: 8 of 8 parents answer 200 (8 with totalItems 0); a well-formed nonexistent id answers 404."
      )
    );
  }

  async getMacEndpointsByADUser(adUserId: string, params?: GroupQueryParams): Promise<MacEndpointsByADUser> {
    return readSubResource(
      async () => {
        const response = await this.client.get<MacEndpointsByADUser>(`${this.basePath}/ADUsers/${adUserId}/MacEndpoints`, { params });
        return response.data;
      },
      adUserId,
      notOverloaded404(
        "Measured 2026-08-14: 8 of 8 parents answer 200 (8 with totalItems 0); a well-formed nonexistent id answers 404."
      )
    );
  }

  async getWindowsEndpointsByADUser(adUserId: string, params?: GroupQueryParams): Promise<WindowsEndpointsByADUser> {
    return readSubResource(
      async () => {
        const response = await this.client.get<WindowsEndpointsByADUser>(`${this.basePath}/ADUsers/${adUserId}/WindowsEndpoints`, { params });
        return response.data;
      },
      adUserId,
      notOverloaded404(
        "Measured 2026-08-14: 8 of 8 parents answer 200 (8 with totalItems 0); a well-formed nonexistent id answers 404."
      )
    );
  }
}
