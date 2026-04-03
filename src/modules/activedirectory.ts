import type { AxiosInstance } from 'axios';
import type { components, operations } from '../generated/activedirectory-types.js';

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
    const response = await this.httpClient.get(
      `${this.basePath}/ADGroups/${adGroupId}/ADUsers`,
      { params }
    );
    return response.data;
  }

  async getADGroupsByOrgUnit(
    orgUnitId: string,
    params: GetADGroupsParams = {}
  ): Promise<ADGroupPagedList> {
    const response = await this.httpClient.get(
      `${this.basePath}/OrgUnits/${orgUnitId}/ADGroups`,
      { params }
    );
    return response.data;
  }

  async getADObjectMemberships(
    id: string,
    params: GetADObjectMembershipsParams = {}
  ): Promise<ADGroupMembershipPagedList> {
    const response = await this.httpClient.get(
      `${this.basePath}/ADObjects/${id}/ADGroupMemberships`,
      { params }
    );
    return response.data;
  }
}
