import type { AxiosInstance } from 'axios';
import type { components, operations } from '../generated/defensecontrol-types.js';

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

// Write operation types - Phase 3
type LocalAdminCredentialsUpdate = operations['PatchLocalAdminUserCredentialsForWindowsEndpointId']['requestBody']['content']['application/json-patch+json'];

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

  async triggerLocalAdminAccountsUpdate(id: string): Promise<any> {
    const response = await this.httpClient.post(
      `${this.basePath}/LocalAdministrativeAccounts/WindowsEndpoints/${id}/TriggerUpdateOnClient`
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
      updateData
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
    const response = await this.httpClient.get(
      `${this.basePath}/MicrosoftDefender/WindowsEndpoints/${endpointId}/Threats`,
      { params }
    );
    return response.data;
  }

  async getMicrosoftDefenderThreatsByLogicalGroup(
    logicalGroupId: string,
    params: GetMicrosoftDefenderThreatsParams = {}
  ): Promise<ThreatPagedList> {
    const response = await this.httpClient.get(
      `${this.basePath}/MicrosoftDefender/LogicalGroups/${logicalGroupId}/Threats`,
      { params }
    );
    return response.data;
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
}
