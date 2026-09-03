/**
 * A full-detail `WindowsEndpoint` row, for measuring what TOK-21 removes.
 *
 * ── Why a fixture and not a live capture ────────────────────────────────────
 * The measurement this fixture stands in for was taken live:
 * `list_windows_endpoints(PageSize=1)` against the labcorp.local bMS 26R1
 * estate returned ONE row of ~3.1 KB, and `get_windows_endpoint` for
 * WORKSTATION1 measured ~2.7 KB (EVAL-2026-08-02.md, TOK-2). A test cannot
 * reach that estate, and the running MCP servers serve a stale build, so this
 * reproduces the row instead: every field name comes from
 * `src/generated/endpoints-types.ts` (`components.schemas.WindowsEndpoint` and
 * the four nested schemas it references), and the values are sized to land in
 * the measured range.
 *
 * It is therefore a SCHEMA-FAITHFUL SYNTHETIC row, not a recording — accurate
 * about which fields exist and roughly how big they are, and not evidence about
 * any particular machine. `windowsEndpointRowBytes()` prints its actual size so
 * a reader can check it against the ~3.1 KB the evaluation measured rather than
 * taking this comment's word for it.
 */

/** Values that make one row look like a real 53-field record. */
export function windowsEndpointRow(index: number): Record<string, unknown> {
  const guid = (seed: string): string =>
    `${seed}${String(index).padStart(4, "0")}-888b-42c4-bd1a-9b8dae0090ba`;

  return {
    id: guid("9dd5"),
    type: "WindowsEndpoint",
    displayName: `WIN11CLIENT${index}`,
    hostName: `WIN11CLIENT${index}`,
    primaryMAC: "00:0C:29:4C:7D:2F",
    macList: "00:0C:29:4C:7D:2F;00:0C:29:4C:7D:39;00:15:5D:01:2A:0B",
    primaryIP: `10.42.7.${index}`,
    primarySubnetMask: "255.255.255.0",
    comment: "Managed by the rollout ring 1 automation. Do not rename.",
    activity: "Job 'INSTALL: Microsoft .Net Core 8.x-x64' finished successfully",
    lastSeen: "2026-07-31T06:14:02Z",
    operatingSystem: "Microsoft Windows 11 Enterprise",
    osVersionString: "10.0.26100",
    logicalGroupId: guid("3f11"),
    logicalGroup: "Clients/Rollout ring 1",
    manufacturer: "VMware, Inc.",
    modelName: "VMware Virtual Platform",
    clientAgentVersion: "26.1.230.0",
    serialNumber: "VMware-56 4d 1a 9c 3f 21 88 b0",
    registeredUser: "LABCORP\\jdoe",
    registeredUserId: guid("77ab"),
    timeZone: "W. Europe Standard Time",
    assignedScannerId: guid("0c31"),
    assignedScannerName: "BMS-SCANNER-01",
    osVersionText: "Windows 11 Enterprise 24H2 (Build 26100.2894)",
    domain: "labcorp.local",
    logicalMAC: "00:0C:29:4C:7D:2F",
    ipNetworkId: guid("5d02"),
    ipNetworkName: "Office LAN 10.42.7.0/24",
    ipList: `10.42.7.${index};169.254.18.44;fe80::a1c2:33ff:fe4c:7d2f`,
    lastUser: "LABCORP\\jdoe",
    ieVersionString: "11.0.26100.1",
    cpu: {
      name: "Intel(R) Xeon(R) Gold 6338 CPU @ 2.00GHz",
      type: "Intel64 Family 6 Model 106 Stepping 6",
      architecture: "x64",
      frequency: 2000000000,
      physicalCPUs: 2,
      logicalCores: 8,
    },
    totalRAM: 17179869184,
    customState: {
      type: 0,
      text: null,
      lastChange: "2026-07-30T22:01:11Z",
    },
    lastChange: "2026-07-31T06:14:02Z",
    bootMode: "UEFI",
    lastBoot: "2026-07-29T05:58:40Z",
    registeredUserUpdateMode: "UseNextLogonUser",
    userRelatedJobExecution: "Default",
    isEnergyManagementActive: true,
    energySchemeId: guid("8ee4"),
    energyScheme: "baramundi Energy Management — office hours",
    isDeactivated: false,
    clientAgentLink: {
      extendedInternetMode: false,
      networkMode: "Lan",
      lastNetworkMode: "Lan",
    },
    clientAgentState: "Connected",
    isAutopilotDevice: false,
    coManagement: "NotConfigured",
    modernManagementState: "NotManaged",
    uuid: guid("564d"),
    storageMedia: [
      {
        index: 0,
        name: "VMware Virtual NVMe Disk",
        byteSize: 137438953472,
        busType: "Nvme",
        partitionStyle: "GPT",
        storageVolumes: [
          {
            driveLetter: "C",
            name: "OSDisk",
            fileSystem: "NTFS",
            fileSystemType: "Ntfs",
            capacity: 133143986176,
            freeSpace: 51539607552,
            isSystemVolume: true,
            volumeId: `\\\\?\\Volume{${guid("aa10")}}\\`,
            partitionType: "Data",
          },
          {
            driveLetter: "",
            name: "EFI System Partition",
            fileSystem: "FAT32",
            fileSystemType: "Fat32",
            capacity: 104857600,
            freeSpace: 71303168,
            isSystemVolume: false,
            volumeId: `\\\\?\\Volume{${guid("bb20")}}\\`,
            partitionType: "EFI_System",
          },
          {
            driveLetter: "",
            name: "Recovery",
            fileSystem: "NTFS",
            fileSystemType: "Ntfs",
            capacity: 838860800,
            freeSpace: 104857600,
            isSystemVolume: false,
            volumeId: `\\\\?\\Volume{${guid("cc30")}}\\`,
            partitionType: "Recovery",
          },
        ],
      },
    ],
    entraIdDeviceId: guid("e17a"),
    opcuaInformation: null,
  };
}

/** A `PageSize`-row page in the envelope shape every bConnect list returns. */
export function windowsEndpointPage(rows = 20): Record<string, unknown> {
  return {
    currentPage: 0,
    pageSize: rows,
    totalPages: 2,
    totalItems: 26,
    hasPreviousPage: false,
    hasNextPage: true,
    data: Array.from({ length: rows }, (_unused, i) => windowsEndpointRow(i + 1)),
  };
}

/** Size of one row as JSON — printed by the measurement test. */
export function windowsEndpointRowBytes(): number {
  return Buffer.byteLength(JSON.stringify(windowsEndpointRow(1)), "utf8");
}
