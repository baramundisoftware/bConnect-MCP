import type { AxiosInstance } from 'axios';
import type { components, operations } from '../generated/activedirectory-types.js';
import { readSubResource, notOverloaded404 } from "@bconnect/mcp-core";

// Type aliases
type ADGroupPagedList = components['schemas']['ADGroupPagedList'];
type ADGroup = components['schemas']['ADGroup'];
type ADUserPagedList = components['schemas']['ADUserPagedList'];
type ADUser = components['schemas']['ADUser'];
type ADObjectPagedList = components['schemas']['ADObjectPagedList'];
type ADObject = components['schemas']['ADObject'];
type OrgUnitPagedList = components['schemas']['OrgUnitPagedList'];
type OrgUnit = components['schemas']['OrgUnit'];
type ADGroupMembershipPagedList = components['schemas']['ADGroupMembershipPagedList'];

// Query parameter types
type GetADGroupsParams = operations['GetADGroups']['parameters']['query'];
type GetADUsersParams = operations['GetADUsers']['parameters']['query'];
type GetADObjectsParams = operations['GetADObjects']['parameters']['query'];
type GetOrgUnitsParams = operations['GetOrgUnits']['parameters']['query'];
type GetADObjectMembershipsParams = operations['GetADObjectMemberships']['parameters']['query'];
type GetADGroupsByADGroupIdParams = operations['GetADGroupsByADGroupId']['parameters']['query'];
type GetADObjectsByADGroupIdParams = operations['GetADObjectsByADGroupId']['parameters']['query'];
type GetADObjectsByOrgUnitIdParams = operations['GetADObjectsByOrgUnitId']['parameters']['query'];
type GetADUsersByOrgUnitIdParams = operations['GetADUsersByOrgUnitId']['parameters']['query'];
type GetOrgUnitsByOrgUnitIdParams = operations['GetOrgUnitsByOrgUnitId']['parameters']['query'];

export class ActiveDirectoryModule {
  private basePath = '/activedirectory/v2.0';

  constructor(private httpClient: AxiosInstance) {}

  async getADGroups(params: GetADGroupsParams = {}): Promise<ADGroupPagedList> {
    const response = await this.httpClient.get(`${this.basePath}/ADGroups`, {
      params,
    });
    return response.data;
  }

  async getADGroup(id: string): Promise<ADGroup> {
    const response = await this.httpClient.get(`${this.basePath}/ADGroups/${id}`);
    return response.data;
  }

  async getADUsers(params: GetADUsersParams = {}): Promise<ADUserPagedList> {
    const response = await this.httpClient.get(`${this.basePath}/ADUsers`, {
      params,
    });
    return response.data;
  }

  async getADUser(id: string): Promise<ADUser> {
    const response = await this.httpClient.get(`${this.basePath}/ADUsers/${id}`);
    return response.data;
  }

  async getADObjects(params: GetADObjectsParams = {}): Promise<ADObjectPagedList> {
    const response = await this.httpClient.get(`${this.basePath}/ADObjects`, {
      params,
    });
    return response.data;
  }

  async getADObject(id: string): Promise<ADObject> {
    const response = await this.httpClient.get(`${this.basePath}/ADObjects/${id}`);
    return response.data;
  }

  async getOrgUnits(params: GetOrgUnitsParams = {}): Promise<OrgUnitPagedList> {
    const response = await this.httpClient.get(`${this.basePath}/OrgUnits`, {
      params,
    });
    return response.data;
  }

  async getOrgUnit(id: string): Promise<OrgUnit> {
    const response = await this.httpClient.get(`${this.basePath}/OrgUnits/${id}`);
    return response.data;
  }

  async getADUsersByGroup(
    adGroupId: string,
    params: GetADUsersParams = {}
  ): Promise<ADUserPagedList> {
    return readSubResource(
      async () => {
        const response = await this.httpClient.get(
          `${this.basePath}/ADGroups/${adGroupId}/ADUsers`,
          { params }
        );
        return response.data;
      },
      adGroupId,
      notOverloaded404(
        "Measured 2026-08-14: 52 of 52 parents answer 200 (42 with totalItems 0, 10 with rows); a well-formed nonexistent id answers 404."
      )
    );
  }

  async getADGroupsByOrgUnit(
    orgUnitId: string,
    params: GetADGroupsParams = {}
  ): Promise<ADGroupPagedList> {
    return readSubResource(
      async () => {
        const response = await this.httpClient.get(
          `${this.basePath}/OrgUnits/${orgUnitId}/ADGroups`,
          { params }
        );
        return response.data;
      },
      orgUnitId,
      notOverloaded404(
        "Measured 2026-08-14: 133 of 133 parents answer 200 (129 with totalItems 0, 4 with rows); a well-formed nonexistent id answers 404."
      )
    );
  }

  async getADObjectMemberships(
    id: string,
    params: GetADObjectMembershipsParams = {}
  ): Promise<ADGroupMembershipPagedList> {
    return readSubResource(
      async () => {
        const response = await this.httpClient.get(
          `${this.basePath}/ADObjects/${id}/ADGroupMemberships`,
          { params }
        );
        return response.data;
      },
      id,
      notOverloaded404(
        "Measured 2026-08-14: 60 of 60 parents answer 200 (44 with totalItems 0, 16 with rows); a well-formed nonexistent id answers 404."
      )
    );
  }

  async getADGroupsByAdGroup(
    adGroupId: string,
    params: GetADGroupsByADGroupIdParams = {}
  ): Promise<ADGroupPagedList> {
    return readSubResource(
      async () => {
        const response = await this.httpClient.get(
          `${this.basePath}/ADGroups/${adGroupId}/ADGroups`,
          { params }
        );
        return response.data;
      },
      adGroupId,
      notOverloaded404(
        "Measured 2026-08-14: 52 of 52 parents answer 200 (49 with totalItems 0, 3 with rows); a well-formed nonexistent id answers 404."
      )
    );
  }

  async getADObjectsByAdGroup(
    adGroupId: string,
    params: GetADObjectsByADGroupIdParams = {}
  ): Promise<ADObjectPagedList> {
    return readSubResource(
      async () => {
        const response = await this.httpClient.get(
          `${this.basePath}/ADGroups/${adGroupId}/ADObjects`,
          { params }
        );
        return response.data;
      },
      adGroupId,
      notOverloaded404(
        "Measured 2026-08-14: 52 of 52 parents answer 200 (42 with totalItems 0, 10 with rows); a well-formed nonexistent id answers 404."
      )
    );
  }

  async getADObjectsByOrgUnit(
    orgUnitId: string,
    params: GetADObjectsByOrgUnitIdParams = {}
  ): Promise<ADObjectPagedList> {
    return readSubResource(
      async () => {
        const response = await this.httpClient.get(
          `${this.basePath}/OrgUnits/${orgUnitId}/ADObjects`,
          { params }
        );
        return response.data;
      },
      orgUnitId,
      notOverloaded404(
        "Measured 2026-08-14: 133 of 133 parents answer 200 (128 with totalItems 0, 5 with rows); a well-formed nonexistent id answers 404."
      )
    );
  }

  async getADUsersByOrgUnit(
    orgUnitId: string,
    params: GetADUsersByOrgUnitIdParams = {}
  ): Promise<ADUserPagedList> {
    return readSubResource(
      async () => {
        const response = await this.httpClient.get(
          `${this.basePath}/OrgUnits/${orgUnitId}/ADUsers`,
          { params }
        );
        return response.data;
      },
      orgUnitId,
      notOverloaded404(
        "Measured 2026-08-14: 133 of 133 parents answer 200 (130 with totalItems 0, 3 with rows); a well-formed nonexistent id answers 404."
      )
    );
  }

  async getOrgUnitsByOrgUnit(
    orgUnitId: string,
    params: GetOrgUnitsByOrgUnitIdParams = {}
  ): Promise<OrgUnitPagedList> {
    return readSubResource(
      async () => {
        const response = await this.httpClient.get(
          `${this.basePath}/OrgUnits/${orgUnitId}/OrgUnits`,
          { params }
        );
        return response.data;
      },
      orgUnitId,
      notOverloaded404(
        "Measured 2026-08-14: 133 of 133 parents answer 200 (121 with totalItems 0, 12 with rows); a well-formed nonexistent id answers 404."
      )
    );
  }
}
