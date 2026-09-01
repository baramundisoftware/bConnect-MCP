/**
 * Where an opaque id comes from.
 *
 * ── The defect ──────────────────────────────────────────────────────────────
 * 147 of 218 tools require at least one opaque GUID, and 127 of them said
 * nothing at all about where to get it. Worse, **no description anywhere in
 * the catalogue named another server**, while 33 tools across 8 servers
 * consume an id only a different server can produce.
 *
 * The logical-group GUID is the sharp case: it is produced solely by
 * `bconnect-endpoints/list_logical_groups` and consumed by tools in five other
 * servers. A deployment that mounts `bconnect-jobs` and `bconnect-groups` —
 * a perfectly reasonable subset — cannot obtain one at all, and nothing in the
 * catalogue or the deployment guide says so. `bconnect-groups` cannot supply
 * it either: it lists group *members*, never groups.
 *
 * Five descriptions were worse than silent. `list_ad_subgroups` said "Use
 * get_ad_group to find the parent group GUID first" — and `get_ad_group`
 * requires that same GUID. Circular.
 *
 * ── Why this is central and not 127 edits ───────────────────────────────────
 * Because 127 hand-edited descriptions across 13 servers is the drift this
 * project keeps finding. The annotation is applied once, in
 * `defineToolCatalogue`, from the table below — and the table is checked
 * against the live catalogue by `__tests__/id-producers.test.ts`, which fails
 * if it names a tool that does not exist or misses a required id parameter.
 *
 * The table was GENERATED from the built catalogue rather than written by
 * hand: for each id parameter, the producer is the `list_<plural(entity)>`
 * tool if the suite has one. 71 of 100 sites resolved that way. The 29 that
 * did not are below in `NO_PRODUCER`, each with the reason — and several of
 * those are findings in their own right rather than gaps in the derivation.
 */

/** `entity` or `<tool>#id` -> `bconnect-<server>/<tool>` that produces it. */
export const ID_PRODUCERS: Readonly<Record<string, string>> = Object.freeze({
  "JobDefinition": "bconnect-jobs/list_job_definitions",
  "adGroup": "bconnect-activedirectory/list_ad_groups",
  "adObject": "bconnect-activedirectory/list_ad_objects",
  "adUser": "bconnect-activedirectory/list_ad_users",
  "assetType": "bconnect-assets/list_asset_types",
  "delete_asset#id": "bconnect-assets/list_assets",
  "delete_asset_stock_folder#id": "bconnect-assets/list_asset_stock_folders",
  "delete_asset_type#id": "bconnect-assets/list_asset_types",
  "delete_asset_type_folder#id": "bconnect-assets/list_asset_type_folders",
  "delete_bundle_application#id": "bconnect-software/list_bundle_applications",
  "delete_bundle_folder#id": "bconnect-software/list_bundle_folders",
  "delete_endpoint#id": "bconnect-endpoints/list_endpoints",
  "delete_job_folder#id": "bconnect-jobs/list_job_folders",
  "delete_job_instance#id": "bconnect-jobs/list_job_instances",
  "delete_logical_group#id": "bconnect-endpoints/list_logical_groups",
  "delete_os_folder#id": "bconnect-operatingsystems/list_os_folders",
  "delete_security_group#id": "bconnect-servermanagement/list_security_groups",
  "delete_security_profile#id": "bconnect-servermanagement/list_security_profiles",
  "delete_variable_definition#id": "bconnect-variables/list_variable_definitions",
  "endpoint": "bconnect-endpoints/list_endpoints",
  "get_ad_group#id": "bconnect-activedirectory/list_ad_groups",
  "get_ad_object#id": "bconnect-activedirectory/list_ad_objects",
  "get_ad_user#id": "bconnect-activedirectory/list_ad_users",
  "get_asset#id": "bconnect-assets/list_assets",
  "get_asset_stock_folder#id": "bconnect-assets/list_asset_stock_folders",
  "get_asset_type#id": "bconnect-assets/list_asset_types",
  "get_asset_type_folder#id": "bconnect-assets/list_asset_type_folders",
  "get_bundle_folder#id": "bconnect-software/list_bundle_folders",
  "get_download_job#id": "bconnect-servermanagement/list_download_jobs",
  "get_endpoint#id": "bconnect-endpoints/list_endpoints",
  "get_job_definition#id": "bconnect-jobs/list_job_definitions",
  "get_job_folder#id": "bconnect-jobs/list_job_folders",
  "get_job_instance#id": "bconnect-jobs/list_job_instances",
  "get_kiosk_release#id": "bconnect-jobs/list_kiosk_releases",
  "get_logical_group#id": "bconnect-endpoints/list_logical_groups",
  "get_microservice#id": "bconnect-servermanagement/list_microservices",
  "get_mobile_device_rule#id": "bconnect-compliance/list_mobile_device_rules",
  "get_org_unit#id": "bconnect-activedirectory/list_org_units",
  "get_os_folder#id": "bconnect-operatingsystems/list_os_folders",
  "get_security_group#id": "bconnect-servermanagement/list_security_groups",
  "get_security_profile#id": "bconnect-servermanagement/list_security_profiles",
  "get_udg_folder#id": "bconnect-universaldynamicgroups/list_udg_folders",
  "get_universal_dynamic_group#id": "bconnect-universaldynamicgroups/list_universal_dynamic_groups",
  "get_update_management_endpoint#id": "bconnect-updatemanagement/list_update_management_endpoints",
  "get_variable_definition#id": "bconnect-variables/list_variable_definitions",
  "get_variable_instance#id": "bconnect-variables/list_variable_instances",
  "get_vulnerability#id": "bconnect-compliance/list_vulnerabilities",
  "jobDefinition": "bconnect-jobs/list_job_definitions",
  "logicalGroup": "bconnect-endpoints/list_logical_groups",
  "orgUnit": "bconnect-activedirectory/list_org_units",
  "restart_microservice#id": "bconnect-servermanagement/list_microservices",
  "resume_job_instance#id": "bconnect-jobs/list_job_instances",
  "start_job_instance#id": "bconnect-jobs/list_job_instances",
  "start_microservice#id": "bconnect-servermanagement/list_microservices",
  "stop_job_instance#id": "bconnect-jobs/list_job_instances",
  "stop_microservice#id": "bconnect-servermanagement/list_microservices",
  "universalDynamicGroup": "bconnect-universaldynamicgroups/list_universal_dynamic_groups",
  "update_asset#id": "bconnect-assets/list_assets",
  "update_asset_stock_folder#id": "bconnect-assets/list_asset_stock_folders",
  "update_asset_type_folder#id": "bconnect-assets/list_asset_type_folders",
  "update_bundle_folder#id": "bconnect-software/list_bundle_folders",
  "update_endpoint#id": "bconnect-endpoints/list_endpoints",
  "update_job_folder#id": "bconnect-jobs/list_job_folders",
  "update_logical_group#id": "bconnect-endpoints/list_logical_groups",
  "update_os_folder#id": "bconnect-operatingsystems/list_os_folders",
  "update_security_group#id": "bconnect-servermanagement/list_security_groups",
  "update_security_profile#id": "bconnect-servermanagement/list_security_profiles",
  "update_update_management_endpoint#id": "bconnect-updatemanagement/list_update_management_endpoints",
  "update_variable_definition#id": "bconnect-variables/list_variable_definitions",
  "update_variable_instance#id": "bconnect-variables/list_variable_instances",
  "withdraw_kiosk_release#id": "bconnect-jobs/list_kiosk_releases",

  // ── Tool-scoped, because the stem is ambiguous across servers ─────────────
  // `folderId` alone names four different folder kinds in four servers, so
  // each one is resolved against its own tool rather than a shared stem.
  "list_asset_stock_subfolders.folderId": "bconnect-assets/list_asset_stock_folders",
  "list_asset_type_subfolders.folderId": "bconnect-assets/list_asset_type_folders",
  "list_job_definitions_by_folder.folderId": "bconnect-jobs/list_job_folders",
  "list_job_subfolders.folderId": "bconnect-jobs/list_job_folders",
  "list_os_folders_by_folder.folderId": "bconnect-operatingsystems/list_os_folders",
  "list_bundle_folders_by_folder.folderId": "bconnect-software/list_bundle_folders",
  "list_udg_folders_by_folder.folderId": "bconnect-universaldynamicgroups/list_udg_folders",
  "list_universal_dynamic_groups_by_folder.folderId":
    "bconnect-universaldynamicgroups/list_udg_folders",

  "list_ad_object_memberships#id": "bconnect-activedirectory/list_ad_objects",
  "create_asset_type.ownerId": "bconnect-assets/list_asset_type_folders",
  "get_defender_threat.threatId": "bconnect-defensecontrol/list_defender_threats",
  "start_enrollment#id": "bconnect-endpoints/list_endpoints",
  "trigger_intune_installation#id": "bconnect-endpoints/list_endpoints",

  "add_application_to_bundle.applicationId": "bconnect-software/list_bundle_applications",
  "add_application_to_bundle.bundleId": "bconnect-software/list_software_bundles",
  "delete_software_bundle.bundleId": "bconnect-software/list_software_bundles",
  "get_software_bundle.bundleId": "bconnect-software/list_software_bundles",
  "list_bundle_applications_by_bundle.bundleId": "bconnect-software/list_software_bundles",
  "replace_application_in_bundle.bundleId": "bconnect-software/list_software_bundles",
  // Not the bundle and not the application: the ASSIGNMENT inside the bundle.
  "replace_application_in_bundle.id": "bconnect-software/list_bundle_applications_by_bundle",

  // The variables server names these Windows-scoped; their producers live in
  // two other servers, which is exactly the hop nothing used to admit.
  "list_variable_instances_by_application.windowsApplicationId":
    "bconnect-software/list_bundle_applications",
  "list_variable_instances_by_job_definition.windowsJobDefinitionId":
    "bconnect-jobs/list_job_definitions",
});

/**
 * Ids with no producer in the catalogue, and what to say instead.
 *
 * Silence here is worse than an explanation: a model retries, or invents a
 * lookup tool. Three groups, and the first two are findings:
 *
 *  - **The tool name lies about the id.** The six `*_maintenance_window_for_*`
 *    tools document `id` as a maintenance-window GUID; the route wants the
 *    ENDPOINT or LOGICAL GROUP GUID, and no tool anywhere lists maintenance
 *    windows. A model reading the parameter name goes looking for a lookup
 *    that cannot exist.
 *  - **Nothing in bConnect 26R1 produces it.** Static and dynamic group ids
 *    are consumed by four job tools and by `list_group_members`, and no route
 *    in the API lists those groups. The id has to come from the bMC console.
 *  - **It is not a bMS id at all.** The Entra ids come from Microsoft Entra,
 *    not from bConnect.
 */
export const NO_PRODUCER: Readonly<Record<string, string>> = Object.freeze({
  "get_maintenance_window_for_endpoint#id":
    "This is the ENDPOINT GUID, not a maintenance-window id — from bconnect-endpoints/list_endpoints. No tool lists maintenance windows.",
  "create_maintenance_window_for_endpoint#id":
    "This is the ENDPOINT GUID, not a maintenance-window id — from bconnect-endpoints/list_endpoints. No tool lists maintenance windows.",
  "update_maintenance_window_for_endpoint#id":
    "This is the ENDPOINT GUID, not a maintenance-window id — from bconnect-endpoints/list_endpoints. No tool lists maintenance windows.",
  "delete_maintenance_window_for_endpoint#id":
    "This is the ENDPOINT GUID, not a maintenance-window id — from bconnect-endpoints/list_endpoints. No tool lists maintenance windows.",
  "get_maintenance_window_for_logical_group#id":
    "This is the LOGICAL GROUP GUID, not a maintenance-window id — from bconnect-endpoints/list_logical_groups. No tool lists maintenance windows.",
  "create_maintenance_window_for_logical_group#id":
    "This is the LOGICAL GROUP GUID, not a maintenance-window id — from bconnect-endpoints/list_logical_groups. No tool lists maintenance windows.",
  "update_maintenance_window_for_logical_group#id":
    "This is the LOGICAL GROUP GUID, not a maintenance-window id — from bconnect-endpoints/list_logical_groups. No tool lists maintenance windows.",
  "delete_maintenance_window_for_logical_group#id":
    "This is the LOGICAL GROUP GUID, not a maintenance-window id — from bconnect-endpoints/list_logical_groups. No tool lists maintenance windows.",
  "staticGroup":
    "No tool lists static groups — bConnect 26R1 serves no such route. Take the GUID from the bMC console.",
  "dynamicGroup":
    "No tool lists dynamic groups — bConnect 26R1 serves no such route. Take the GUID from the bMC console. Note these are NOT Universal Dynamic Groups, which have their own id space and their own list tool.",
  "entraIdDevice": "A Microsoft Entra device id, not a bMS id. It comes from Entra, not from bConnect.",
  "EntraIdDevice": "A Microsoft Entra device id, not a bMS id. It comes from Entra, not from bConnect.",
  "entraIdTenant": "A Microsoft Entra tenant id, not a bMS id. It comes from Entra, not from bConnect.",
  "entraIdUser": "A Microsoft Entra user id, not a bMS id. It comes from Entra, not from bConnect.",
  "device": "A Microsoft Entra device id, not a bMS id. It comes from Entra, not from bConnect.",

  // ── Polymorphic: the right producer depends on another argument ───────────
  // Naming one would be wrong for the other cases, and a pointer to the wrong
  // tool is worse than no pointer — which is the whole lesson of the five
  // circular references this work removed.
  "list_group_members.groupId":
    "Which tool produces this depends on groupKind: 'logical' from list_logical_groups in bconnect-endpoints, 'universalDynamic' from list_universal_dynamic_groups in bconnect-universaldynamicgroups. For 'static' and 'dynamic' no tool exists — bConnect 26R1 serves no route listing those groups, so take the GUID from the bMC console.",
  "create_asset.ownerId":
    "What this identifies depends on ownerType: an endpoint (from list_endpoints in bconnect-endpoints), an AD user (from list_ad_users in bconnect-activedirectory), or an asset stock. Match it to the ownerType you pass.",
  "get_access_rights.objectId":
    "Any securable bMS object — an endpoint, a group, a job or a folder — so the producer is whichever list tool covers the object type you are asking about. Pass the same kind of GUID you would pass to that object's own get_ tool.",
  "update_object_permission#id":
    "Any securable bMS object — an endpoint, a group, a job or a folder — so the producer is whichever list tool covers the object type whose permission you are changing.",
  // Added 2026-08-11 when the parameter was renamed from the optional
  // `targetId` to the spec-required `assignmentTargetId` (KioskReleaseForCreation
  // requires it — TOOL-REVIEW-MATRIX.md H2). Polymorphic like the entries above.
  "create_kiosk_release.assignmentTargetId":
    "The assignment target is an endpoint, a group or an AD object, so the producer depends on which you are releasing to: list_endpoints in bconnect-endpoints, list_logical_groups in bconnect-endpoints, or list_ad_objects in bconnect-activedirectory.",
});

/** A tool entry as the catalogue sees it — structural, like `ToolLike`. */
interface AnnotatableTool {
  name: string;
  inputSchema?: {
    properties?: Record<string, { description?: string } & Record<string, unknown>>;
    required?: string[];
  };
}

/**
 * Keys to try for one parameter on one tool, most specific first.
 *
 * Three levels, because the same parameter name means different things in
 * different servers: `folderId` is a job folder in `bconnect-jobs`, an asset
 * stock folder in `bconnect-assets`, an OS folder in `bconnect-operatingsystems`
 * and a bundle folder in `bconnect-software`. A stem-keyed table alone would
 * have to pick one and be wrong four times.
 */
export function producerKeys(toolName: string, parameter: string): string[] {
  const keys = [`${toolName}.${parameter}`];
  if (parameter.toLowerCase() === "id") {
    keys.push(`${toolName}#id`);
  } else {
    keys.push(parameter.replace(/Id$/i, ""));
  }
  return keys;
}

/** The first key that resolves, and what it resolved to. */
export function resolveProducer(
  toolName: string,
  parameter: string
): { producer?: string; note?: string } {
  for (const key of producerKeys(toolName, parameter)) {
    if (ID_PRODUCERS[key]) {return { producer: ID_PRODUCERS[key] };}
    if (NO_PRODUCER[key]) {return { note: NO_PRODUCER[key] };}
  }
  return {};
}

/**
 * Append the producer sentence to every id parameter that has one.
 *
 * Two shapes, and the difference is the point of the whole exercise: a
 * same-server producer is named bare, a foreign one carries its server, so a
 * model can see that the call needs a server it may not have mounted.
 *
 * Idempotent — a description that already names its producer is left alone, so
 * the hand-written cross-references that were already correct are not doubled.
 */
export function annotateIdParameters<T extends AnnotatableTool>(
  tools: readonly T[],
  ownToolNames: ReadonlySet<string>
): T[] {
  return tools.map((tool) => {
    const props = tool.inputSchema?.properties;
    if (!props) {return tool;}

    let touched = false;
    const next: Record<string, unknown> = {};
    for (const [name, spec] of Object.entries(props)) {
      next[name] = spec;
      if (!/id$/i.test(name)) {continue;}

      const { producer, note: noProducer } = resolveProducer(tool.name, name);
      if (!producer && !noProducer) {continue;}

      const current = String(spec?.description ?? "");
      const sentence = producer
        ? `From ${producer.split("/")[1]!}${
            ownToolNames.has(producer.split("/")[1]!) ? "" : ` in ${producer.split("/")[0]!}`
          }.`
        : noProducer!;
      if (current.includes(sentence)) {continue;}

      // Not every existing description ends in punctuation — several are bare
      // fragments like "Logical group ID (GUID)" — and running two sentences
      // together reads as one broken one.
      const joined = current
        ? `${current}${/[.!?]$/.test(current) ? "" : "."} ${sentence}`
        : sentence;
      next[name] = { ...spec, description: joined };
      touched = true;
    }
    if (!touched) {return tool;}
    return {
      ...tool,
      inputSchema: { ...tool.inputSchema, properties: next },
    } as T;
  });
}
