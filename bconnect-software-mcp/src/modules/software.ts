import type { AxiosInstance } from 'axios';
import type { components, operations } from '../generated/software-types.js';
import { readSubResource, notOverloaded404 } from "@bconnect/mcp-core";

// Type aliases
type InstalledWindowsSoftwarePagedList = components['schemas']['InstalledWindowsSoftwarePagedList'];
type SoftwareBundlePagedList = components['schemas']['SoftwareBundlePagedList'];
type SoftwareBundle = components['schemas']['SoftwareBundle'];
type SoftwareBundleForCreation = components['schemas']['SoftwareBundleForCreation'];
type SoftwareBundleApplicationPagedList = components['schemas']['SoftwareBundleApplicationPagedList'];
type SoftwareBundleApplication = components['schemas']['SoftwareBundleApplication'];
type AddApplicationRequest = components['schemas']['AddApplicationRequest'];
type JsonPatchDocument = components['schemas']['JsonPatchDocument'];
type BundleFolderPagedList = components['schemas']['BundleFolderPagedList'];
type BundleFolder = components['schemas']['BundleFolder'];
type BundleFolderForCreation = components['schemas']['BundleFolderForCreation'];

// Query parameter types
type GetInstalledSoftwareParams = operations['GetInstalledWindowsSoftware']['parameters']['query'];
type GetBundlesParams = operations['GetSoftwareBundles']['parameters']['query'];
type GetBundleAppsParams = operations['GetBundleApplications']['parameters']['query'];
type GetBundleFoldersParams = operations['GetBundleFolders']['parameters']['query'];
type GetBundleFoldersByFolderIdParams = operations['GetBundleFoldersByFolderId']['parameters']['query'];

export class SoftwareModule {
  private basePath = '/software/v2.0';

  constructor(private httpClient: AxiosInstance) {}

  // ── Installed Software ───────────────────────────────────────────────────

  async getInstalledWindowsSoftware(
    params: GetInstalledSoftwareParams = {}
  ): Promise<InstalledWindowsSoftwarePagedList> {
    const response = await this.httpClient.get(
      `${this.basePath}/InstalledWindowsSoftware`,
      { params }
    );
    return response.data;
  }

  async getInstalledSoftwareByEndpoint(
    endpointId: string,
    params: GetInstalledSoftwareParams = {}
  ): Promise<InstalledWindowsSoftwarePagedList> {
    return readSubResource(
      async () => {
        const response = await this.httpClient.get(
          `${this.basePath}/WindowsEndpoints/${endpointId}/InstalledWindowsSoftware`,
          { params }
        );
        return response.data;
      },
      endpointId,
      notOverloaded404(
        "Measured 2026-08-14: 23 of 23 parents answer 200 (1 with totalItems 0, 22 with rows); a well-formed nonexistent id answers 404."
      )
    );
  }

  async getInstalledSoftwareByLogicalGroup(
    logicalGroupId: string,
    params: GetInstalledSoftwareParams = {}
  ): Promise<InstalledWindowsSoftwarePagedList> {
    return readSubResource(
      async () => {
        const response = await this.httpClient.get(
          `${this.basePath}/LogicalGroups/${logicalGroupId}/InstalledWindowsSoftware`,
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

  async getInstalledSoftwareByUniversalDynamicGroup(
    universalDynamicGroupId: string,
    params: GetInstalledSoftwareParams = {}
  ): Promise<InstalledWindowsSoftwarePagedList> {
    return readSubResource(
      async () => {
        const response = await this.httpClient.get(
          `${this.basePath}/UniversalDynamicGroups/${universalDynamicGroupId}/InstalledWindowsSoftware`,
          { params }
        );
        return response.data;
      },
      universalDynamicGroupId,
      notOverloaded404(
        "Measured 2026-08-14: 55 of 55 parents answer 200 (17 with totalItems 0, 38 with rows); a well-formed nonexistent id answers 404."
      )
    );
  }

  // ── Software Bundles (26R1) ──────────────────────────────────────────────

  async getSoftwareBundles(
    params: GetBundlesParams = {}
  ): Promise<SoftwareBundlePagedList> {
    const response = await this.httpClient.get(
      `${this.basePath}/Bundles`,
      { params }
    );
    return response.data;
  }

  async getSoftwareBundle(bundleId: string): Promise<SoftwareBundle> {
    const response = await this.httpClient.get(
      `${this.basePath}/Bundles/${bundleId}`
    );
    return response.data;
  }

  async createSoftwareBundle(body: SoftwareBundleForCreation): Promise<SoftwareBundle> {
    const response = await this.httpClient.post(
      `${this.basePath}/Bundles`,
      body
    );
    return response.data;
  }

  async deleteSoftwareBundle(bundleId: string): Promise<void> {
    await this.httpClient.delete(`${this.basePath}/Bundles/${bundleId}`);
  }

  // ── Bundle Applications (26R1) ───────────────────────────────────────────

  async getBundleApplications(
    params: GetBundleAppsParams = {}
  ): Promise<SoftwareBundleApplicationPagedList> {
    const response = await this.httpClient.get(
      `${this.basePath}/BundleApplications`,
      { params }
    );
    return response.data;
  }

  async getBundleApplicationsByBundle(
    bundleId: string,
    params: GetBundleAppsParams = {}
  ): Promise<SoftwareBundleApplicationPagedList> {
    const response = await this.httpClient.get(
      `${this.basePath}/Bundles/${bundleId}/BundleApplications`,
      { params }
    );
    return response.data;
  }

  async addApplicationToBundle(
    bundleId: string,
    body: AddApplicationRequest
  ): Promise<SoftwareBundleApplication> {
    const response = await this.httpClient.post(
      `${this.basePath}/Bundles/${bundleId}/BundleApplications`,
      body
    );
    return response.data;
  }

  async deleteBundleApplication(id: string): Promise<void> {
    await this.httpClient.delete(`${this.basePath}/BundleApplications/${id}`);
  }

  async replaceApplicationInBundle(
    bundleId: string,
    id: string,
    patchDoc: JsonPatchDocument
  ): Promise<SoftwareBundleApplication> {
    const response = await this.httpClient.patch(
      `${this.basePath}/Bundles/${bundleId}/BundleApplications/${id}`,
      patchDoc,
      { headers: { 'Content-Type': 'application/json-patch+json' } }
    );
    return response.data;
  }

  // ── Bundle Folders (26R1) ────────────────────────────────────────────────

  async getBundleFolders(
    params: GetBundleFoldersParams = {}
  ): Promise<BundleFolderPagedList> {
    const response = await this.httpClient.get(
      `${this.basePath}/Bundle/Folders`,
      { params }
    );
    return response.data;
  }

  async getBundleFolder(id: string): Promise<BundleFolder> {
    const response = await this.httpClient.get(
      `${this.basePath}/Bundle/Folders/${id}`
    );
    return response.data;
  }

  async getBundleFoldersByFolder(
    folderId: string,
    params: GetBundleFoldersByFolderIdParams = {}
  ): Promise<BundleFolderPagedList> {
    return readSubResource(
      async () => {
        const response = await this.httpClient.get(
          `${this.basePath}/Bundle/Folders/${folderId}/Folders`,
          { params }
        );
        return response.data;
      },
      folderId,
      notOverloaded404(
        "Measured 2026-08-14: 1 of 1 parents answer 200 (1 with totalItems 0); a well-formed nonexistent id answers 404."
      )
    );
  }

  async createBundleFolder(body: BundleFolderForCreation): Promise<BundleFolder> {
    const response = await this.httpClient.post(
      `${this.basePath}/Bundle/Folders`,
      body
    );
    return response.data;
  }

  async deleteBundleFolder(id: string): Promise<void> {
    await this.httpClient.delete(`${this.basePath}/Bundle/Folders/${id}`);
  }

  async updateBundleFolder(
    id: string,
    patchDoc: JsonPatchDocument
  ): Promise<BundleFolder> {
    const response = await this.httpClient.patch(
      `${this.basePath}/Bundle/Folders/${id}`,
      patchDoc,
      { headers: { 'Content-Type': 'application/json-patch+json' } }
    );
    return response.data;
  }
}
