import type { AxiosInstance } from 'axios';
import type { components, operations } from '../generated/defensecontrol-types.js';
import { readSubResource, notOverloaded404 } from "@bconnect/mcp-core";

// Type aliases
type BitLockerWindowsEndpointPagedList = components['schemas']['BitLockerWindowsEndpointPagedList'];
type BitLockerWindowsEndpoint = components['schemas']['BitLockerWindowsEndpoint'];
type LocalAdminAccountWindowsEndpoint = components['schemas']['LocalAdminAccountWindowsEndpoint'];
type ThreatPagedList = components['schemas']['ThreatPagedList'];
type Threat = components['schemas']['Threat'];
type MicrosoftDefenderWindowsEndpointPagedList = components['schemas']['MicrosoftDefenderWindowsEndpointPagedList'];
type MicrosoftDefenderState = components['schemas']['MicrosoftDefenderState'];

// Query parameter types
type GetBitLockerStatesParams = operations['GetBitLockerStates']['parameters']['query'];
type GetMicrosoftDefenderThreatsParams = operations['GetMicrosoftDefenderThreats']['parameters']['query'];
type GetMicrosoftDefenderStatesParams = operations['GetMicrosoftDefenderStates']['parameters']['query'];

// Write operation types
type LocalAdminCredentialsUpdate = operations['PatchLocalAdminUserCredentialsForWindowsEndpointId']['requestBody']['content']['application/json-patch+json'];
type BitLockerPinUpdate = NonNullable<operations['UpdateBitLockerPinByWindowsEndpointId']['requestBody']>['content']['application/json-patch+json'];

// 26R1 type aliases
type BitLockerSecrets = components['schemas']['BitLockerSecrets'];

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
export class DefenseControlModule {
  private basePath = '/defensecontrol/v2.0';

  constructor(private httpClient: AxiosInstance) {}

  // BitLocker endpoints
  async getBitLockerWindowsEndpoints(
    params: GetBitLockerStatesParams = {}
  ): Promise<BitLockerWindowsEndpointPagedList> {
    const response = await this.httpClient.get(`${this.basePath}/BitLocker/WindowsEndpoints`, {
      params,
    });
    return response.data;
  }

  async getBitLockerWindowsEndpoint(id: string): Promise<BitLockerWindowsEndpoint> {
    const response = await this.httpClient.get(`${this.basePath}/BitLocker/WindowsEndpoints/${id}`);
    return response.data;
  }

  // Local Administrative Accounts endpoints
  async getLocalAdministrativeAccounts(id: string): Promise<LocalAdminAccountWindowsEndpoint> {
    const response = await this.httpClient.get(
      `${this.basePath}/LocalAdministrativeAccounts/WindowsEndpoints/${id}`
    );
    return response.data;
  }

  // ============================================================================
  // LOCAL ADMIN ACCOUNTS WRITE OPERATIONS - Phase 3
  // ============================================================================

  /**
   * Trigger immediate update on client for local admin account expiration date
   */
  async triggerUpdateOnClient(id: string, timeout?: number): Promise<boolean> {
    const response = await this.httpClient.post<boolean>(
      `${this.basePath}/LocalAdministrativeAccounts/WindowsEndpoints/${id}/TriggerUpdateOnClient`,
      null,
      { params: timeout !== undefined ? { timeout } : {} }
    );
    return response.data;
  }

  /**
   * Update local admin account expiration date for a Windows endpoint
   */
  async patchLocalAdminUserCredentials(id: string, updateData: LocalAdminCredentialsUpdate): Promise<LocalAdminAccountWindowsEndpoint> {
    const response = await this.httpClient.patch<LocalAdminAccountWindowsEndpoint>(
      `${this.basePath}/LocalAdministrativeAccounts/WindowsEndpoints/${id}`,
      updateData,
      JSON_PATCH_REQUEST
    );
    return response.data;
  }

  // Microsoft Defender Threats endpoints
  async getMicrosoftDefenderThreats(
    params: GetMicrosoftDefenderThreatsParams = {}
  ): Promise<ThreatPagedList> {
    const response = await this.httpClient.get(`${this.basePath}/MicrosoftDefender/Threats`, {
      params,
    });
    return response.data;
  }

  async getMicrosoftDefenderThreat(id: string): Promise<Threat> {
    const response = await this.httpClient.get(`${this.basePath}/MicrosoftDefender/Threats/${id}`);
    return response.data;
  }

  async getMicrosoftDefenderThreatsByEndpoint(
    endpointId: string,
    params: GetMicrosoftDefenderThreatsParams = {}
  ): Promise<ThreatPagedList> {
    return readSubResource(
      async () => {
        const response = await this.httpClient.get(
          `${this.basePath}/MicrosoftDefender/WindowsEndpoints/${endpointId}/Threats`,
          { params }
        );
        return response.data;
      },
      endpointId,
      notOverloaded404(
        "Measured 2026-08-14: 23 of 23 parents answer 200 (23 with totalItems 0); a well-formed nonexistent id answers 404."
      )
    );
  }

  async getMicrosoftDefenderThreatsByLogicalGroup(
    logicalGroupId: string,
    params: GetMicrosoftDefenderThreatsParams = {}
  ): Promise<ThreatPagedList> {
    return readSubResource(
      async () => {
        const response = await this.httpClient.get(
          `${this.basePath}/MicrosoftDefender/LogicalGroups/${logicalGroupId}/Threats`,
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

  // Microsoft Defender Endpoints
  async getMicrosoftDefenderWindowsEndpoints(
    params: GetMicrosoftDefenderStatesParams = {}
  ): Promise<MicrosoftDefenderWindowsEndpointPagedList> {
    const response = await this.httpClient.get(`${this.basePath}/MicrosoftDefender/WindowsEndpoints`, {
      params,
    });
    return response.data;
  }

  async getMicrosoftDefenderWindowsEndpoint(id: string): Promise<MicrosoftDefenderState> {
    const response = await this.httpClient.get(`${this.basePath}/MicrosoftDefender/WindowsEndpoints/${id}`);
    return response.data;
  }

  // 26R1-only methods
  async getBitLockerSecrets(id: string): Promise<BitLockerSecrets> {
    const response = await this.httpClient.get(`${this.basePath}/BitLocker/WindowsEndpoints/${id}/Secrets`);
    return response.data;
  }

  // Route corrected 2026-08-03 — this is finding B12, carried unfixed since the
  // original evaluation. The method called `/Pin`, which the API does not serve
  // (confirmed three ways at the time, including against baramundi's own
  // PowerShell client). 26R1 declares UpdateBitLockerPinByWindowsEndpointId at
  // PATCH /v2.0/BitLocker/WindowsEndpoints/{id}/Secrets.
  //
  // Not verified on the wire here: exercising it means writing a BitLocker PIN to
  // a real endpoint. The spec and the prior three-way confirmation agree, which is
  // the strongest evidence available without a write. If this is ever exercised
  // for real, confirm the response before trusting it.
  async updateBitLockerPin(id: string, patchData: BitLockerPinUpdate): Promise<BitLockerSecrets> {
    const response = await this.httpClient.patch(`${this.basePath}/BitLocker/WindowsEndpoints/${id}/Secrets`, patchData, {
      headers: { 'Content-Type': 'application/json-patch+json' },
    });
    return response.data;
  }
}
