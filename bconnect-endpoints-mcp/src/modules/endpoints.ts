/**
 * bConnect Endpoints Module
 *
 * Handles endpoint (device) management operations
 */

import type { AxiosInstance } from "axios";
import type { operations, paths } from "../generated/endpoints-types.js";
import { readSubResource, notOverloaded404 } from "@bconnect/mcp-core";

// Type aliases for cleaner code - READ operations
type EndpointsList = paths["/v2.0/Endpoints"]["get"]["responses"]["200"]["content"]["application/json"];
type Endpoint = paths["/v2.0/Endpoints/{id}"]["get"]["responses"]["200"]["content"]["application/json"];
type WindowsEndpointsList = paths["/v2.0/WindowsEndpoints"]["get"]["responses"]["200"]["content"]["application/json"];
type WindowsEndpoint = paths["/v2.0/WindowsEndpoints/{id}"]["get"]["responses"]["200"]["content"]["application/json"];

// Type aliases for READ operations on platform endpoint lists
type LinuxEndpointsList = paths["/v2.0/LinuxEndpoints"]["get"]["responses"]["200"]["content"]["application/json"];
type MacEndpointsList = paths["/v2.0/MacEndpoints"]["get"]["responses"]["200"]["content"]["application/json"];
type LogicalGroupsList = paths["/v2.0/LogicalGroups"]["get"]["responses"]["200"]["content"]["application/json"];

// Type aliases for READ operations on individual platform endpoints
type LinuxEndpoint = paths["/v2.0/LinuxEndpoints/{id}"]["get"]["responses"]["200"]["content"]["application/json"];
type MacEndpoint = paths["/v2.0/MacEndpoints/{id}"]["get"]["responses"]["200"]["content"]["application/json"];
type LogicalGroup = paths["/v2.0/LogicalGroups/{id}"]["get"]["responses"]["200"]["content"]["application/json"];

// Type aliases for group-based endpoint list operations
type EndpointsByLogicalGroupList = paths["/v2.0/LogicalGroups/{logicalGroupId}/Endpoints"]["get"]["responses"]["200"]["content"]["application/json"];
type WindowsEndpointsByLogicalGroupList = paths["/v2.0/LogicalGroups/{logicalGroupId}/WindowsEndpoints"]["get"]["responses"]["200"]["content"]["application/json"];

// Type aliases for Android WRITE operations
type AndroidEndpointForCreation = paths["/v2.0/AndroidEndpoints"]["post"]["requestBody"]["content"]["application/json"];
type AndroidEndpoint = paths["/v2.0/AndroidEndpoints"]["post"]["responses"]["201"]["content"]["application/json"];
type AndroidEndpointUpdate = paths["/v2.0/AndroidEndpoints/{id}"]["patch"]["requestBody"]["content"]["application/json-patch+json"];
type AndroidEnrollmentRequest = paths["/v2.0/AndroidEndpoints/{id}/StartEnrollment"]["post"]["requestBody"]["content"]["application/json"];
type AndroidEnrollmentResponse = paths["/v2.0/AndroidEndpoints/{id}/StartEnrollment"]["post"]["responses"]["200"]["content"]["application/json"];

// Type aliases for iOS WRITE operations
type IosEndpointForCreation = paths["/v2.0/IosEndpoints"]["post"]["requestBody"]["content"]["application/json"];
type IosEndpoint = paths["/v2.0/IosEndpoints"]["post"]["responses"]["201"]["content"]["application/json"];
type IosEndpointUpdate = paths["/v2.0/IosEndpoints/{id}"]["patch"]["requestBody"]["content"]["application/json-patch+json"];
type IosEnrollmentRequest = paths["/v2.0/IosEndpoints/{id}/StartEnrollment"]["post"]["requestBody"]["content"]["application/json"];
type IosEnrollmentResponse = paths["/v2.0/IosEndpoints/{id}/StartEnrollment"]["post"]["responses"]["200"]["content"]["application/json"];

// Type aliases for Windows Endpoint WRITE operations
type WindowsEndpointForCreation = paths["/v2.0/WindowsEndpoints"]["post"]["requestBody"]["content"]["application/json"];
type WindowsEndpointCreated = paths["/v2.0/WindowsEndpoints"]["post"]["responses"]["201"]["content"]["application/json"];
type WindowsEndpointUpdate = paths["/v2.0/WindowsEndpoints/{id}"]["patch"]["requestBody"]["content"]["application/json-patch+json"];
type WindowsEndpointUpdated = paths["/v2.0/WindowsEndpoints/{id}"]["patch"]["responses"]["200"]["content"]["application/json"];
type WindowsEnrollmentRequest = paths["/v2.0/WindowsEndpoints/{id}/StartEnrollment"]["post"]["requestBody"]["content"]["application/json"];
type WindowsEnrollmentResponse = paths["/v2.0/WindowsEndpoints/{id}/StartEnrollment"]["post"]["responses"]["200"]["content"]["application/json"];

// Type aliases for Linux Endpoint WRITE operations
type LinuxEndpointForCreation = paths["/v2.0/LinuxEndpoints"]["post"]["requestBody"]["content"]["application/json"];
type LinuxEndpointCreated = paths["/v2.0/LinuxEndpoints"]["post"]["responses"]["201"]["content"]["application/json"];
type LinuxEndpointUpdate = paths["/v2.0/LinuxEndpoints/{id}"]["patch"]["requestBody"]["content"]["application/json-patch+json"];
type LinuxEndpointUpdated = paths["/v2.0/LinuxEndpoints/{id}"]["patch"]["responses"]["200"]["content"]["application/json"];

// Type aliases for Mac Endpoint WRITE operations
type MacEndpointForCreation = paths["/v2.0/MacEndpoints"]["post"]["requestBody"]["content"]["application/json"];
type MacEndpointCreated = paths["/v2.0/MacEndpoints"]["post"]["responses"]["201"]["content"]["application/json"];
type MacEndpointUpdate = paths["/v2.0/MacEndpoints/{id}"]["patch"]["requestBody"]["content"]["application/json-patch+json"];
type MacEndpointUpdated = paths["/v2.0/MacEndpoints/{id}"]["patch"]["responses"]["200"]["content"]["application/json"];
type MacEnrollmentRequest = paths["/v2.0/MacEndpoints/{id}/StartEnrollment"]["post"]["requestBody"]["content"]["application/json"];
type MacEnrollmentResponse = paths["/v2.0/MacEndpoints/{id}/StartEnrollment"]["post"]["responses"]["200"]["content"]["application/json"];

// Type aliases for LogicalGroup WRITE operations
type LogicalGroupForCreation = paths["/v2.0/LogicalGroups"]["post"]["requestBody"]["content"]["application/json"];
type LogicalGroupCreated = paths["/v2.0/LogicalGroups"]["post"]["responses"]["201"]["content"]["application/json"];
type LogicalGroupUpdate = paths["/v2.0/LogicalGroups/{id}"]["patch"]["requestBody"]["content"]["application/json-patch+json"];
type LogicalGroupUpdated = paths["/v2.0/LogicalGroups/{id}"]["patch"]["responses"]["200"]["content"]["application/json"];

// Type aliases for Maintenance Window operations - Phase 3
type MaintenanceWindowData = paths["/v2.0/Endpoints/{id}/MaintenanceWindow"]["post"]["requestBody"]["content"]["application/json"];
type MaintenanceWindow = paths["/v2.0/Endpoints/{id}/MaintenanceWindow"]["post"]["responses"]["201"]["content"]["application/json"];
type MaintenanceWindowGet = paths["/v2.0/Endpoints/{id}/MaintenanceWindow"]["get"]["responses"]["200"]["content"]["application/json"];
type MaintenanceWindowForGroupGet = paths["/v2.0/LogicalGroups/{id}/MaintenanceWindow"]["get"]["responses"]["200"]["content"]["application/json"];
type MaintenanceWindowForGroup = paths["/v2.0/LogicalGroups/{id}/MaintenanceWindow"]["patch"]["responses"]["200"]["content"]["application/json"];

// Type aliases for Android GET operations - Phase 24
type AndroidEndpointGet = paths["/v2.0/AndroidEndpoints/{id}"]["get"]["responses"]["200"]["content"]["application/json"];
type AndroidEndpointsList = paths["/v2.0/AndroidEndpoints"]["get"]["responses"]["200"]["content"]["application/json"];

// Type aliases for iOS GET operations - Phase 24
type IosEndpointGet = paths["/v2.0/IosEndpoints/{id}"]["get"]["responses"]["200"]["content"]["application/json"];
type IosEndpointsList = paths["/v2.0/IosEndpoints"]["get"]["responses"]["200"]["content"]["application/json"];

// Type aliases for Network GET operations - Phase 24
type NetworkEndpointGet = paths["/v2.0/NetworkEndpoints/{id}"]["get"]["responses"]["200"]["content"]["application/json"];
type NetworkEndpointsList = paths["/v2.0/NetworkEndpoints"]["get"]["responses"]["200"]["content"]["application/json"];

// ── IndustrialEndpoints: removed in 26R1 (product decision 1) ───────────────
//
// 25R2 declared eight /v2.0/IndustrialEndpoints operations and three schemas.
// bConnect_Endpoints.json 26R1 declares none of them, so the five type aliases
// that used to sit here have no `paths` entry to alias and the five module
// methods below them had no route to call — every industrial tool would have
// 404ed against a 26R1 bMS. Removed rather than left to fail at runtime.
//
// The `Deprecated_IndustrialEndpoint` value is still in the regenerated
// EndpointType enum, on the vendor's own instruction ("Removed in 26.1. Keep to
// avoid gaps in enum values"), because historical endpoint records still carry
// it and dropping it would break their deserialisation. That is the enum VALUE;
// the ROUTES are what is gone.

// Type aliases for 26R1 unmanaged-endpoint operations
type UnmanagedEndpointsList = paths["/v2.0/UnmanagedEndpoints"]["get"]["responses"]["200"]["content"]["application/json"];
type UnmanagedEndpoint = paths["/v2.0/UnmanagedEndpoints/{id}"]["get"]["responses"]["200"]["content"]["application/json"];

// Type alias for the 26R1 EntraID lookup — note the route: the data is keyed on
// the ENTRA device id, not on a baramundi endpoint id. See getEntraIdData().
type EntraIdEndpointData = paths["/v2.0/EntraIdData/{deviceId}"]["get"]["responses"]["200"]["content"]["application/json"];

// Type aliases for Network Endpoint WRITE operations - Phase 3
type NetworkEndpointForCreation = paths["/v2.0/NetworkEndpoints"]["post"]["requestBody"]["content"]["application/json"];
type NetworkEndpoint = paths["/v2.0/NetworkEndpoints"]["post"]["responses"]["201"]["content"]["application/json"];
type NetworkEndpointUpdate = paths["/v2.0/NetworkEndpoints/{id}"]["patch"]["requestBody"]["content"]["application/json-patch+json"];

// ── Query-parameter types (upstream finding OPT-42) ─────────────────────────
//
// These were hand-written interfaces whose own doc comments said they
// "mirror" the generated operations types. A mirror maintained by hand is
// drift waiting for the next spec refresh, and it had already drifted: the
// old EndpointsQueryParams omitted `HostName`, which GET /v2.0/Endpoints
// declares and which list_endpoints has advertised to callers all along.
// Deriving them from `operations` costs nothing at runtime and makes the next
// divergence a compile error instead of a silently-dropped filter.

/** Query parameters GET /v2.0/Endpoints declares. */
export type EndpointsQueryParams = NonNullable<operations["GetEndpoints"]["parameters"]["query"]>;

/** Query parameters GET /v2.0/LogicalGroups declares — see the LOCAL FIX note
 *  on getLogicalGroups() below (D14b / D3). */
export type LogicalGroupsQueryParams = NonNullable<operations["GetLogicalGroups"]["parameters"]["query"]>;

/**
 * Query parameters GET /v2.0/WindowsEndpoints declares.
 *
 * This used to be the generated shape INTERSECTED with a hand-written
 * `{ EntraIdDeviceId?: string }`, because the types were emitted from 25R2 and
 * 25R2 does not declare that parameter while the tool advertised it. The types
 * are now generated from 26R1, which declares it on both Windows list routes
 * (`GetWindowsEndpoints` and `GetWindowsEndpointsByLogicalGroupId`), so the
 * intersection is gone — verified by the fact that removing it still compiles
 * with `EntraIdDeviceId` in use.
 */
export type WindowsEndpointsQueryParams =
  NonNullable<operations["GetWindowsEndpoints"]["parameters"]["query"]>;

/** Query parameters GET /v2.0/LinuxEndpoints declares. */
export type LinuxEndpointsQueryParams = NonNullable<operations["GetLinuxEndpoints"]["parameters"]["query"]>;

/** Query parameters GET /v2.0/MacEndpoints declares. */
export type MacEndpointsQueryParams = NonNullable<operations["GetMacEndpoints"]["parameters"]["query"]>;

/** Query parameters GET /v2.0/AndroidEndpoints declares (no HostName filter). */
export type AndroidEndpointsQueryParams = NonNullable<operations["GetAndroidEndpoints"]["parameters"]["query"]>;

/** Query parameters GET /v2.0/IosEndpoints declares (no HostName filter). */
export type IosEndpointsQueryParams = NonNullable<operations["GetIOSEndpoints"]["parameters"]["query"]>;

/** Query parameters GET /v2.0/NetworkEndpoints declares. */
export type NetworkEndpointsQueryParams = NonNullable<operations["GetNetworkEndpoints"]["parameters"]["query"]>;

/**
 * Query parameters GET /v2.0/UnmanagedEndpoints declares — which is NONE.
 *
 * `GetAllUnmanagedEndpoints` takes no parameters at all in 26R1. The removed
 * `list_unmanaged_endpoints` tool advertised SearchQuery, OrderBy, Page and
 * PageSize; per finding D6 bConnect answered 200 and dropped all four, so that
 * tool returned the whole set whatever was asked of it. `Record<string, never>`
 * makes passing one a compile error rather than a silent no-op.
 */
export type UnmanagedEndpointsQueryParams = Record<string, never>;

/** Query parameters GET /v2.0/LogicalGroups/{logicalGroupId}/Endpoints
 *  declares — note `includeSubfolders`, which the plain list routes lack. */
export type EndpointsByLogicalGroupQueryParams =
  NonNullable<operations["GetEndpointsByLogicalGroupId"]["parameters"]["query"]>;

/** Query parameters GET /v2.0/LogicalGroups/{logicalGroupId}/WindowsEndpoints
 *  declares. */
export type WindowsEndpointsByLogicalGroupQueryParams =
  NonNullable<operations["GetWindowsEndpointsByLogicalGroupId"]["parameters"]["query"]>;

/** Query parameters the per-platform group-scoped list routes declare. */
export type LinuxEndpointsByLogicalGroupQueryParams =
  NonNullable<operations["GetLinuxEndpointsByLogicalGroupId"]["parameters"]["query"]>;
export type MacEndpointsByLogicalGroupQueryParams =
  NonNullable<operations["GetMacEndpointsByLogicalGroupId"]["parameters"]["query"]>;
export type AndroidEndpointsByLogicalGroupQueryParams =
  NonNullable<operations["GetAndroidEndpointsByLogicalGroupId"]["parameters"]["query"]>;
export type IosEndpointsByLogicalGroupQueryParams =
  NonNullable<operations["GetIOSEndpointsByLogicalGroupId"]["parameters"]["query"]>;
export type NetworkEndpointsByLogicalGroupQueryParams =
  NonNullable<operations["GetNetworkEndpointsByLogicalGroupId"]["parameters"]["query"]>;

/**
 * The ONLY content type any bConnect PATCH route accepts.
 *
 * Measured 2026-08-19 across all 26R1 specs: 25 PATCH operations, every one
 * declaring `application/json-patch+json` and nothing else. axios sends
 * `application/json` when no config is passed (measured against a capturing
 * adapter), which those routes answer with 415.
 *
 * Enforced by `__tests__/suite-patch-content-type.test.ts`, which reads call-site
 * ARGUMENTS rather than grepping for this string — the string also appears in
 * generated type aliases, and counting it wrongly cleared two modules.
 */
const JSON_PATCH_REQUEST = { headers: { 'Content-Type': 'application/json-patch+json' } } as const;
export class EndpointsModule {
  private basePath = "/endpoints/v2.0";

  constructor(private client: AxiosInstance) {}

  /**
   * Get all endpoints with optional filtering and pagination
   */
  async getEndpoints(params?: EndpointsQueryParams): Promise<EndpointsList> {
    const response = await this.client.get<EndpointsList>(
      `${this.basePath}/Endpoints`,
      { params }
    );
    return response.data;
  }

  /**
   * Get a specific endpoint by ID
   */
  async getEndpoint(id: string): Promise<Endpoint> {
    const response = await this.client.get<Endpoint>(
      `${this.basePath}/Endpoints/${id}`
    );
    return response.data;
  }

  /**
   * Search endpoints by query string
   * Searches across DisplayName, HostName, PrimaryIP, OSVersionString, SerialNumber, and Comment
   *
   * LOCAL FIX — D3: `page` added (optional, additive) so search_endpoints can
   * reach results past the first page. GET /v2.0/Endpoints declares Page; the
   * tool could not send it, yet the envelope still reported hasNextPage: true.
   */
  async searchEndpoints(query: string, pageSize?: number, page?: number): Promise<EndpointsList> {
    return this.getEndpoints({
      SearchQuery: query,
      PageSize: pageSize || 50,
      ...(page !== undefined ? { Page: page } : {})
    });
  }

  /**
   * Get endpoints by display name
   */
  async getEndpointsByName(displayName: string): Promise<EndpointsList> {
    return this.getEndpoints({
      DisplayName: displayName
    });
  }

  /**
   * Get all Windows endpoints
   */
  async getWindowsEndpoints(params?: WindowsEndpointsQueryParams): Promise<WindowsEndpointsList> {
    const response = await this.client.get<WindowsEndpointsList>(
      `${this.basePath}/WindowsEndpoints`,
      { params }
    );
    return response.data;
  }

  /**
   * Get a specific Windows endpoint by ID
   */
  async getWindowsEndpoint(id: string): Promise<WindowsEndpoint> {
    const response = await this.client.get<WindowsEndpoint>(
      `${this.basePath}/WindowsEndpoints/${id}`
    );
    return response.data;
  }

  /**
   * Get all endpoints (any type) assigned to a specific logical group
   *
   * TOK-26 — `getLogicalGroupEndpoints()` used to sit directly above this
   * method and issue the byte-identical request: same verb, same
   * `<basePath>/LogicalGroups/{logicalGroupId}/Endpoints` URL, same
   * params type, same response type. Two module methods and two tools
   * (`list_group_endpoints`, `list_endpoints_by_logical_group`) for one
   * operation. Deleted with its tool; this is the one that survives.
   *
   * The URL above is deliberately NOT written as a live template literal. The
   * ARCH-1 scan offers every template to `isSubResourceTemplate` and lets the
   * path shape decide, which is what makes it blind to how a read is called —
   * so a real path quoted in PROSE counts as a read too, and this comment kept
   * the route on `UNDECLARED_SUB_RESOURCE_READS` after the method below had
   * declared it. Over-inclusion is the safe direction for finding reads; it is
   * the wrong direction for reporting one as unmeasured.
   */
  async getEndpointsByLogicalGroup(
    logicalGroupId: string,
    params?: EndpointsByLogicalGroupQueryParams
  ): Promise<EndpointsByLogicalGroupList> {
    return readSubResource(
      async () => {
        const response = await this.client.get<EndpointsByLogicalGroupList>(
          `${this.basePath}/LogicalGroups/${logicalGroupId}/Endpoints`,
          { params }
        );
        return response.data;
      },
      logicalGroupId,
      notOverloaded404(
        "Measured 2026-08-14: 19 of 19 parents answer 200 (13 with totalItems 0, 6 with rows); a well-formed nonexistent id answers 404."
      )
    );
  }

  /**
   * Get all Windows endpoints assigned to a specific logical group
   */
  async getWindowsEndpointsByLogicalGroup(
    logicalGroupId: string,
    params?: WindowsEndpointsByLogicalGroupQueryParams
  ): Promise<WindowsEndpointsByLogicalGroupList> {
    return readSubResource(
      async () => {
        const response = await this.client.get<WindowsEndpointsByLogicalGroupList>(
          `${this.basePath}/LogicalGroups/${logicalGroupId}/WindowsEndpoints`,
          { params }
        );
        return response.data;
      },
      logicalGroupId,
      notOverloaded404(
        "Measured 2026-08-14: 19 of 19 parents answer 200 (15 with totalItems 0, 4 with rows); a well-formed nonexistent id answers 404."
      )
    );
  }

  /**
   * Get all logical groups
   *
   * LOCAL FIX — D14b / D3: this method took no arguments at all, so the four
   * filters GET /v2.0/LogicalGroups declares (Name, Dip, Domain) and its
   * pagination (Page/PageSize/OrderBy/SearchQuery) were unreachable — the tool
   * could only ever fetch page 0 of everything. `params` is optional and
   * additive, so existing callers are unaffected.
   */
  async getLogicalGroups(params?: LogicalGroupsQueryParams): Promise<LogicalGroupsList> {
    const response = await this.client.get(
      `${this.basePath}/LogicalGroups`,
      { params }
    );
    return response.data;
  }

  /**
   * Get a specific logical group
   */
  async getLogicalGroup(id: string): Promise<LogicalGroup> {
    const response = await this.client.get(
      `${this.basePath}/LogicalGroups/${id}`
    );
    return response.data;
  }

  /**
   * Get Linux endpoints
   */
  async getLinuxEndpoints(params?: LinuxEndpointsQueryParams): Promise<LinuxEndpointsList> {
    const response = await this.client.get(
      `${this.basePath}/LinuxEndpoints`,
      { params }
    );
    return response.data;
  }

  /**
   * Get a specific Linux endpoint by ID
   */
  async getLinuxEndpoint(id: string): Promise<LinuxEndpoint> {
    const response = await this.client.get<LinuxEndpoint>(
      `${this.basePath}/LinuxEndpoints/${id}`
    );
    return response.data;
  }

  /**
   * Get Mac endpoints
   */
  async getMacEndpoints(params?: MacEndpointsQueryParams): Promise<MacEndpointsList> {
    const response = await this.client.get(
      `${this.basePath}/MacEndpoints`,
      { params }
    );
    return response.data;
  }

  /**
   * Get a specific Mac endpoint by ID
   */
  async getMacEndpoint(id: string): Promise<MacEndpoint> {
    const response = await this.client.get<MacEndpoint>(
      `${this.basePath}/MacEndpoints/${id}`
    );
    return response.data;
  }

  /**
   * Get Android endpoints
   */
  async getAndroidEndpoints(params?: AndroidEndpointsQueryParams): Promise<AndroidEndpointsList> {
    const response = await this.client.get(
      `${this.basePath}/AndroidEndpoints`,
      { params }
    );
    return response.data;
  }

  /**
   * Get iOS endpoints
   */
  async getIosEndpoints(params?: IosEndpointsQueryParams): Promise<IosEndpointsList> {
    const response = await this.client.get(
      `${this.basePath}/IosEndpoints`,
      { params }
    );
    return response.data;
  }

  // WRITE OPERATIONS - Android Endpoints

  /**
   * Create a new Android endpoint
   */
  async createAndroidEndpoint(endpointData: AndroidEndpointForCreation): Promise<AndroidEndpoint> {
    const response = await this.client.post<AndroidEndpoint>(
      `${this.basePath}/AndroidEndpoints`,
      endpointData
    );
    return response.data;
  }

  /**
   * Update an existing Android endpoint
   */
  /**
   * ARCH-2 — was `Promise<void>`, discarding a declared 200 body.
   *
   * 200 is "Returns the updated android endpoint according to the specified properties". A
   * JSON-Patch that silently no-ops — a wrong path, an unmatched test op — answers 200 with the
   * record UNCHANGED, and that is the only way to tell.
   */
  async updateAndroidEndpoint(id: string, updateData: AndroidEndpointUpdate): Promise<AndroidEndpoint> {
    const response = await this.client.patch<AndroidEndpoint>(
      `${this.basePath}/AndroidEndpoints/${id}`,
      updateData,
      JSON_PATCH_REQUEST
    );
    return response.data;
  }

  /**
   * Delete an Android endpoint by ID
   */
  async deleteAndroidEndpoint(id: string): Promise<void> {
    await this.client.delete(
      `${this.basePath}/AndroidEndpoints/${id}`
    );
  }

  /**
   * Start enrollment for an Android endpoint
   * @param id - The endpoint ID
   * @param enrollmentData - Optional enrollment data (emailRecipient, emailLanguageId)
   */
  async startAndroidEnrollment(id: string, enrollmentData?: AndroidEnrollmentRequest): Promise<AndroidEnrollmentResponse> {
    const response = await this.client.post<AndroidEnrollmentResponse>(
      `${this.basePath}/AndroidEndpoints/${id}/StartEnrollment`,
      enrollmentData
    );
    return response.data;
  }

  // WRITE OPERATIONS - iOS Endpoints

  /**
   * Create a new iOS endpoint
   */
  async createIosEndpoint(endpointData: IosEndpointForCreation): Promise<IosEndpoint> {
    const response = await this.client.post<IosEndpoint>(
      `${this.basePath}/IosEndpoints`,
      endpointData
    );
    return response.data;
  }

  /**
   * Update an existing iOS endpoint
   */
  /**
   * ARCH-2 — was `Promise<void>`, discarding a declared 200 body.
   *
   * Same JSON-Patch no-op risk as the Android variant above.
   */
  async updateIosEndpoint(id: string, updateData: IosEndpointUpdate): Promise<IosEndpoint> {
    const response = await this.client.patch<IosEndpoint>(
      `${this.basePath}/IosEndpoints/${id}`,
      updateData,
      JSON_PATCH_REQUEST
    );
    return response.data;
  }

  /**
   * Delete an iOS endpoint by ID
   */
  async deleteIosEndpoint(id: string): Promise<void> {
    await this.client.delete(
      `${this.basePath}/IosEndpoints/${id}`
    );
  }

  /**
   * Start enrollment for an iOS endpoint
   * @param id - The endpoint ID
   * @param enrollmentData - Optional enrollment data (emailRecipient, emailLanguageId)
   */
  async startIosEnrollment(id: string, enrollmentData?: IosEnrollmentRequest): Promise<IosEnrollmentResponse> {
    const response = await this.client.post<IosEnrollmentResponse>(
      `${this.basePath}/IosEndpoints/${id}/StartEnrollment`,
      enrollmentData
    );
    return response.data;
  }

  // ============================================================================
  // WINDOWS ENDPOINT WRITE OPERATIONS - Phase 1
  // ============================================================================

  /**
   * Create a new Windows endpoint
   */
  async createWindowsEndpoint(endpointData: WindowsEndpointForCreation): Promise<WindowsEndpointCreated> {
    const response = await this.client.post<WindowsEndpointCreated>(
      `${this.basePath}/WindowsEndpoints`,
      endpointData
    );
    return response.data;
  }

  /**
   * Update an existing Windows endpoint
   */
  async updateWindowsEndpoint(id: string, updateData: WindowsEndpointUpdate): Promise<WindowsEndpointUpdated> {
    const response = await this.client.patch<WindowsEndpointUpdated>(
      `${this.basePath}/WindowsEndpoints/${id}`,
      updateData,
      JSON_PATCH_REQUEST
    );
    return response.data;
  }

  /**
   * Delete a Windows endpoint by ID
   */
  async deleteWindowsEndpoint(id: string): Promise<void> {
    await this.client.delete(
      `${this.basePath}/WindowsEndpoints/${id}`
    );
  }

  /**
   * Start enrollment for a Windows endpoint
   */
  /**
   * Start enrollment for a Windows endpoint, returning the route's 200 body.
   *
   * ── ARCH-2. It was `Promise<void>` ─────────────────────────────────────
   * The POST was awaited and `response.data` thrown away, so
   * `WindowsEnrollmentResponse{installCommand, validUntil}` never reached the
   * caller — and the handler filled the gap with a fabricated
   * `{success: true, message: "… enrollment started"}`. The one artefact the
   * operator actually needs to enrol the machine is `installCommand`, and it
   * was being replaced with a sentence asserting success.
   *
   * `startAndroidEnrollment` two methods down has always returned its body.
   * The Windows and Mac pair were the odd ones out, not the pattern.
   */
  async startWindowsEndpointEnrollment(id: string, enrollmentData?: WindowsEnrollmentRequest): Promise<WindowsEnrollmentResponse> {
    const response = await this.client.post<WindowsEnrollmentResponse>(
      `${this.basePath}/WindowsEndpoints/${id}/StartEnrollment`,
      enrollmentData
    );
    return response.data;
  }

  /**
   * Trigger baramundi Agent installation and enrollment via Intune for a
   * Windows endpoint, returning the route's 200 body — which the spec declares
   * as a bare `boolean`.
   *
   * It was `Promise<void>`: the POST was awaited and `response.data` thrown
   * away, so a 200 carrying `false` reached the caller as success. What false
   * MEANS is undocumented, which is why the handler reports it without naming
   * a cause. Typed `unknown` rather than
   * `boolean` because the caller must be able to tell a missing flag from a
   * false one; absent is not success.
   */
  async triggerInstallationViaIntune(id: string): Promise<unknown> {
    const response = await this.client.post(
      `${this.basePath}/WindowsEndpoints/${id}/TriggerInstallationViaIntune`
    );
    return response.data;
  }

  // ============================================================================
  // LINUX ENDPOINT WRITE OPERATIONS - Phase 1
  // ============================================================================

  /**
   * Create a new Linux endpoint
   */
  async createLinuxEndpoint(endpointData: LinuxEndpointForCreation): Promise<LinuxEndpointCreated> {
    const response = await this.client.post<LinuxEndpointCreated>(
      `${this.basePath}/LinuxEndpoints`,
      endpointData
    );
    return response.data;
  }

  /**
   * Update an existing Linux endpoint
   */
  async updateLinuxEndpoint(id: string, updateData: LinuxEndpointUpdate): Promise<LinuxEndpointUpdated> {
    const response = await this.client.patch<LinuxEndpointUpdated>(
      `${this.basePath}/LinuxEndpoints/${id}`,
      updateData,
      JSON_PATCH_REQUEST
    );
    return response.data;
  }

  /**
   * Delete a Linux endpoint by ID
   */
  async deleteLinuxEndpoint(id: string): Promise<void> {
    await this.client.delete(
      `${this.basePath}/LinuxEndpoints/${id}`
    );
  }

  // ============================================================================
  // MAC ENDPOINT WRITE OPERATIONS - Phase 1
  // ============================================================================

  /**
   * Create a new Mac endpoint
   */
  async createMacEndpoint(endpointData: MacEndpointForCreation): Promise<MacEndpointCreated> {
    const response = await this.client.post<MacEndpointCreated>(
      `${this.basePath}/MacEndpoints`,
      endpointData
    );
    return response.data;
  }

  /**
   * Update an existing Mac endpoint
   */
  async updateMacEndpoint(id: string, updateData: MacEndpointUpdate): Promise<MacEndpointUpdated> {
    const response = await this.client.patch<MacEndpointUpdated>(
      `${this.basePath}/MacEndpoints/${id}`,
      updateData,
      JSON_PATCH_REQUEST
    );
    return response.data;
  }

  /**
   * Delete a Mac endpoint by ID
   */
  async deleteMacEndpoint(id: string): Promise<void> {
    await this.client.delete(
      `${this.basePath}/MacEndpoints/${id}`
    );
  }

  /**
   * Start enrollment for a Mac endpoint
   */
  /**
   * Start enrollment for a Mac endpoint, returning the route's 200 body.
   *
   * ── ARCH-2, and the worst instance of the class ────────────────────────
   * `MacEnrollmentResponse` declares **six** fields — `fqdn`, `token`,
   * `tokenValidUntilUTC`, `url`, `qrCodeText`, `qrCodeImageBase64`. That is
   * the entire enrollment profile: the QR code a technician scans at the
   * machine, and the token that expires. All six were discarded and replaced
   * with `{success: true}`.
   *
   * A caller could not tell the difference between "enrollment started, here
   * is the QR code" and "enrollment started", and only one of those lets them
   * finish the job.
   */
  async startMacEndpointEnrollment(id: string, enrollmentData?: MacEnrollmentRequest): Promise<MacEnrollmentResponse> {
    const response = await this.client.post<MacEnrollmentResponse>(
      `${this.basePath}/MacEndpoints/${id}/StartEnrollment`,
      enrollmentData
    );
    return response.data;
  }

  // ============================================================================
  // LOGICAL GROUP WRITE OPERATIONS - Phase 1
  // ============================================================================

  /**
   * Create a new logical group
   */
  async createLogicalGroup(groupData: LogicalGroupForCreation): Promise<LogicalGroupCreated> {
    const response = await this.client.post<LogicalGroupCreated>(
      `${this.basePath}/LogicalGroups`,
      groupData
    );
    return response.data;
  }

  /**
   * Update an existing logical group
   */
  async updateLogicalGroup(id: string, updateData: LogicalGroupUpdate): Promise<LogicalGroupUpdated> {
    const response = await this.client.patch<LogicalGroupUpdated>(
      `${this.basePath}/LogicalGroups/${id}`,
      updateData,
      JSON_PATCH_REQUEST
    );
    return response.data;
  }

  /**
   * Delete a logical group by ID (group must be empty)
   */
  async deleteLogicalGroup(id: string): Promise<void> {
    await this.client.delete(
      `${this.basePath}/LogicalGroups/${id}`
    );
  }

  // ============================================================================
  // MAINTENANCE WINDOW WRITE OPERATIONS - Phase 3
  // ============================================================================

  /**
   * Create a maintenance window for an endpoint
   */
  async createMaintenanceWindowForEndpoint(id: string, maintenanceWindowData: MaintenanceWindowData): Promise<MaintenanceWindow> {
    const response = await this.client.post<MaintenanceWindow>(
      `${this.basePath}/Endpoints/${id}/MaintenanceWindow`,
      maintenanceWindowData
    );
    return response.data;
  }

  /**
   * Update a maintenance window for an endpoint
   */
  /**
   * ARCH-2 — was `Promise<void>`, discarding a declared 200 body.
   *
   * The 200 description is literally "The maintenance window was updated as requested and can be
   * seen in the body of the response". Nothing looked at that body, so a PATCH that applied
   * something other than what was asked reported the same as one that applied it exactly.
   */
  async updateMaintenanceWindowForEndpoint(id: string, maintenanceWindowData: MaintenanceWindowData): Promise<MaintenanceWindow> {
    const response = await this.client.patch<MaintenanceWindow>(
      `${this.basePath}/Endpoints/${id}/MaintenanceWindow`,
      maintenanceWindowData,
      JSON_PATCH_REQUEST
    );
    return response.data;
  }

  /**
   * Delete a maintenance window for an endpoint
   */
  async deleteMaintenanceWindowForEndpoint(id: string): Promise<void> {
    await this.client.delete(
      `${this.basePath}/Endpoints/${id}/MaintenanceWindow`
    );
  }

  /**
   * Create a maintenance window for a logical group
   */
  async createMaintenanceWindowForLogicalGroup(id: string, maintenanceWindowData: MaintenanceWindowData): Promise<MaintenanceWindow> {
    const response = await this.client.post<MaintenanceWindow>(
      `${this.basePath}/LogicalGroups/${id}/MaintenanceWindow`,
      maintenanceWindowData
    );
    return response.data;
  }

  /**
   * Update a maintenance window for a logical group
   */
  /**
   * ARCH-2 — was `Promise<void>`, discarding a declared 200 body.
   *
   * Same route shape and same 200 wording as the endpoint variant above.
   */
  async updateMaintenanceWindowForLogicalGroup(id: string, maintenanceWindowData: MaintenanceWindowData): Promise<MaintenanceWindowForGroup> {
    const response = await this.client.patch<MaintenanceWindowForGroup>(
      `${this.basePath}/LogicalGroups/${id}/MaintenanceWindow`,
      maintenanceWindowData,
      JSON_PATCH_REQUEST
    );
    return response.data;
  }

  /**
   * Delete a maintenance window for a logical group
   */
  async deleteMaintenanceWindowForLogicalGroup(id: string): Promise<void> {
    await this.client.delete(
      `${this.basePath}/LogicalGroups/${id}/MaintenanceWindow`
    );
  }

  // ============================================================================
  // NETWORK ENDPOINT WRITE OPERATIONS - Phase 3
  // ============================================================================
  //
  // The five INDUSTRIAL ENDPOINT methods used to sit immediately above this
  // block. They are gone with the API: 26R1 declares no /v2.0/IndustrialEndpoints
  // route, so listIndustrialEndpoints(), getIndustrialEndpoint(),
  // createIndustrialEndpoint(), updateIndustrialEndpoint() and
  // deleteIndustrialEndpoint() could only have produced 404s. See the type-alias
  // note near the top of this file for what survives and why.

  /**
   * Create a new network endpoint
   */
  async createNetworkEndpoint(endpointData: NetworkEndpointForCreation): Promise<NetworkEndpoint> {
    const response = await this.client.post<NetworkEndpoint>(
      `${this.basePath}/NetworkEndpoints`,
      endpointData
    );
    return response.data;
  }

  /**
   * Update an existing network endpoint
   */
  async updateNetworkEndpoint(id: string, updateData: NetworkEndpointUpdate): Promise<NetworkEndpoint> {
    const response = await this.client.patch<NetworkEndpoint>(
      `${this.basePath}/NetworkEndpoints/${id}`,
      updateData,
      JSON_PATCH_REQUEST
    );
    return response.data;
  }

  /**
   * Delete a network endpoint by ID
   */
  async deleteNetworkEndpoint(id: string): Promise<void> {
    await this.client.delete(
      `${this.basePath}/NetworkEndpoints/${id}`
    );
  }

  // ============================================================================
  // GENERIC ENDPOINT DELETE OPERATION - Phase 3
  // ============================================================================

  /**
   * Delete any endpoint by ID (generic delete)
   * Works for all endpoint types (Windows, Linux, Mac, Android, iOS, Industrial, Network, etc.)
   */
  async deleteEndpoint(id: string): Promise<void> {
    await this.client.delete(
      `${this.basePath}/Endpoints/${id}`
    );
  }

  // ============================================================================
  // PHASE 24 — MISSING READ OPERATIONS
  // ============================================================================

  /**
   * Get a specific Android endpoint by ID
   */
  async getAndroidEndpoint(id: string): Promise<AndroidEndpointGet> {
    const response = await this.client.get<AndroidEndpointGet>(
      `${this.basePath}/AndroidEndpoints/${id}`
    );
    return response.data;
  }

  /**
   * Get a list of all Android endpoints
   */
  async listAndroidEndpoints(params?: AndroidEndpointsQueryParams): Promise<AndroidEndpointsList> {
    const response = await this.client.get<AndroidEndpointsList>(
      `${this.basePath}/AndroidEndpoints`,
      { params }
    );
    return response.data;
  }

  /**
   * Get a specific iOS endpoint by ID
   */
  async getIosEndpoint(id: string): Promise<IosEndpointGet> {
    const response = await this.client.get<IosEndpointGet>(
      `${this.basePath}/IosEndpoints/${id}`
    );
    return response.data;
  }

  /**
   * Get a list of all iOS endpoints
   */
  async listIosEndpoints(params?: IosEndpointsQueryParams): Promise<IosEndpointsList> {
    const response = await this.client.get<IosEndpointsList>(
      `${this.basePath}/IosEndpoints`,
      { params }
    );
    return response.data;
  }

  /**
   * Get all network endpoints
   */
  async listNetworkEndpoints(params?: NetworkEndpointsQueryParams): Promise<NetworkEndpointsList> {
    const response = await this.client.get<NetworkEndpointsList>(
      `${this.basePath}/NetworkEndpoints`,
      { params }
    );
    return response.data;
  }

  /**
   * Get a specific network endpoint by ID
   */
  async getNetworkEndpoint(id: string): Promise<NetworkEndpointGet> {
    const response = await this.client.get<NetworkEndpointGet>(
      `${this.basePath}/NetworkEndpoints/${id}`
    );
    return response.data;
  }

  /**
   * Get the maintenance window for a specific endpoint.
   *
   * This route's "absent" state is **409, not 404** — the one pair in the 78
   * probed where that is true. Measured live 2026-08-14: 25 of 26 endpoints
   * answer 409 with the detail "Requested resource has no maintenance window",
   * one answers 200, and a well-formed nonexistent id answers 404. The same
   * figures were already recorded at `tool-error.ts`'s EXPECTED_HTTP_STATUSES,
   * which is why 409 is routed as a caller-recoverable answer rather than an
   * InternalError.
   *
   * So the 404 here carries nothing but "bad id", and says so on the record.
   */
  async getMaintenanceWindowForEndpoint(id: string): Promise<MaintenanceWindowGet> {
    return readSubResource(
      async () => {
        const response = await this.client.get<MaintenanceWindowGet>(
          `${this.basePath}/Endpoints/${id}/MaintenanceWindow`
        );
        return response.data;
      },
      id,
      notOverloaded404(
        "Measured 2026-08-14: the absent state is 409 (25 of 26 endpoints), not 404; 1 answers 200 and a nonexistent id answers 404."
      )
    );
  }

  /**
   * Get the maintenance window for a logical group.
   *
   * Same shape as the endpoint route above, measured the same day: 18 of 19
   * logical groups answer 409, one answers 200, a nonexistent id answers 404.
   */
  async getMaintenanceWindowForLogicalGroup(id: string): Promise<MaintenanceWindowForGroupGet> {
    return readSubResource(
      async () => {
        const response = await this.client.get<MaintenanceWindowForGroupGet>(
          `${this.basePath}/LogicalGroups/${id}/MaintenanceWindow`
        );
        return response.data;
      },
      id,
      notOverloaded404(
        "Measured 2026-08-14: the absent state is 409 (18 of 19 logical groups), not 404; 1 answers 200 and a nonexistent id answers 404."
      )
    );
  }

  // ============================================================================
  // PHASE 24 — 26R1-ONLY OPERATIONS (Unmanaged Endpoints + EntraID)
  // ============================================================================

  /**
   * Get all endpoints of one platform in a logical group.
   *
   * The five per-platform group routes below had no module method and no tool
   * before this release — only the Windows one did. They exist in 26R1 and the
   * collapsed `list_endpoints_by_logical_group` reaches all of them.
   */
  async getLinuxEndpointsByLogicalGroup(
    logicalGroupId: string,
    params?: LinuxEndpointsByLogicalGroupQueryParams
  ): Promise<LinuxEndpointsList> {
    return readSubResource(
      async () => {
        const response = await this.client.get<LinuxEndpointsList>(
          `${this.basePath}/LogicalGroups/${logicalGroupId}/LinuxEndpoints`,
          { params }
        );
        return response.data;
      },
      logicalGroupId,
      notOverloaded404(
        "Measured 2026-08-14: 19 of 19 parents answer 200 (18 with totalItems 0, 1 with rows); a well-formed nonexistent id answers 404."
      )
    );
  }

  async getMacEndpointsByLogicalGroup(
    logicalGroupId: string,
    params?: MacEndpointsByLogicalGroupQueryParams
  ): Promise<MacEndpointsList> {
    return readSubResource(
      async () => {
        const response = await this.client.get<MacEndpointsList>(
          `${this.basePath}/LogicalGroups/${logicalGroupId}/MacEndpoints`,
          { params }
        );
        return response.data;
      },
      logicalGroupId,
      notOverloaded404(
        "Measured 2026-08-14: 19 of 19 parents answer 200 (19 with totalItems 0); a well-formed nonexistent id answers 404."
      )
    );
  }

  async getAndroidEndpointsByLogicalGroup(
    logicalGroupId: string,
    params?: AndroidEndpointsByLogicalGroupQueryParams
  ): Promise<AndroidEndpointsList> {
    return readSubResource(
      async () => {
        const response = await this.client.get<AndroidEndpointsList>(
          `${this.basePath}/LogicalGroups/${logicalGroupId}/AndroidEndpoints`,
          { params }
        );
        return response.data;
      },
      logicalGroupId,
      notOverloaded404(
        "Measured 2026-08-14: 19 of 19 parents answer 200 (19 with totalItems 0); a well-formed nonexistent id answers 404."
      )
    );
  }

  async getIosEndpointsByLogicalGroup(
    logicalGroupId: string,
    params?: IosEndpointsByLogicalGroupQueryParams
  ): Promise<IosEndpointsList> {
    return readSubResource(
      async () => {
        const response = await this.client.get<IosEndpointsList>(
          `${this.basePath}/LogicalGroups/${logicalGroupId}/IosEndpoints`,
          { params }
        );
        return response.data;
      },
      logicalGroupId,
      notOverloaded404(
        "Measured 2026-08-14: 19 of 19 parents answer 200 (19 with totalItems 0); a well-formed nonexistent id answers 404."
      )
    );
  }

  async getNetworkEndpointsByLogicalGroup(
    logicalGroupId: string,
    params?: NetworkEndpointsByLogicalGroupQueryParams
  ): Promise<NetworkEndpointsList> {
    return readSubResource(
      async () => {
        const response = await this.client.get<NetworkEndpointsList>(
          `${this.basePath}/LogicalGroups/${logicalGroupId}/NetworkEndpoints`,
          { params }
        );
        return response.data;
      },
      logicalGroupId,
      notOverloaded404(
        "Measured 2026-08-14: 19 of 19 parents answer 200 (18 with totalItems 0, 1 with rows); a well-formed nonexistent id answers 404."
      )
    );
  }

  /**
   * Get all unmanaged endpoints.
   *
   * Now typed against its own 26R1 operation rather than borrowed from
   * `GetEndpoints`. `GetAllUnmanagedEndpoints` declares no query parameters at
   * all, which is why `UnmanagedEndpointsQueryParams` is `Record<string, never>`
   * — see the note on that type.
   */
  async listUnmanagedEndpoints(params?: UnmanagedEndpointsQueryParams): Promise<UnmanagedEndpointsList> {
    const response = await this.client.get<UnmanagedEndpointsList>(
      `${this.basePath}/UnmanagedEndpoints`,
      { params }
    );
    return response.data;
  }

  /**
   * Get a specific unmanaged endpoint by ID
   */
  async getUnmanagedEndpoint(id: string): Promise<UnmanagedEndpoint> {
    const response = await this.client.get<UnmanagedEndpoint>(
      `${this.basePath}/UnmanagedEndpoints/${id}`
    );
    return response.data;
  }

  /**
   * Delete an unmanaged endpoint by ID (26R1 only)
   */
  async deleteUnmanagedEndpoint(id: string): Promise<void> {
    await this.client.delete(
      `${this.basePath}/UnmanagedEndpoints/${id}`
    );
  }

  /**
   * Get the EntraID endpoint data for one Entra device id.
   *
   * ── A route that never existed ─────────────────────────────────────────────
   * This method used to issue `GET /v2.0/Endpoints/{endpointId}/EntraIdData`.
   * No bConnect release declares that operation: 25R2 has no EntraID routes at
   * all, and 26R1 declares POST and DELETE on
   * `/v2.0/Endpoints/{endpointId}/EntraIdData` but puts the GET on
   * `/v2.0/EntraIdData/{deviceId}` — keyed on the ENTRA device id, not on a
   * baramundi endpoint id. Every `get_entra_id_data` call would have 404ed.
   *
   * Corrected to the declared route, which changes the argument the tool takes.
   */
  async getEntraIdData(deviceId: string): Promise<EntraIdEndpointData> {
    const response = await this.client.get<EntraIdEndpointData>(
      `${this.basePath}/EntraIdData/${deviceId}`
    );
    return response.data;
  }

  /**
   * Link EntraID data to an endpoint (26R1 only).
   *
   * The body is EntraIdEndpointDataForCreation — exactly the three entraId*
   * fields, additionalProperties: false. This method posted `{ deviceId }`
   * until 2026-08-11, a key that schema rejects, so every "successful" link
   * sent an effectively empty body (undefined serializes away).
   */
  async linkEntraIdData(
    endpointId: string,
    data: { entraIdDeviceId?: string; entraIdTenantId?: string; entraIdUserId?: string }
  ): Promise<unknown> {
    const response = await this.client.post(
      `${this.basePath}/Endpoints/${endpointId}/EntraIdData`,
      data
    );
    return response.data;
  }

  /**
   * Unlink EntraID data from an endpoint (26R1 only)
   */
  async unlinkEntraIdData(endpointId: string): Promise<void> {
    await this.client.delete(
      `${this.basePath}/Endpoints/${endpointId}/EntraIdData`
    );
  }
}
