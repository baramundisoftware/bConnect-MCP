/**
 * The `includeSubfolders` argument of tools that list a logical group's
 * members (#170). bConnect counts only direct members unless it is set, and a
 * parent group often has none, so without it such a group looks empty.
 */

export interface IncludeSubfoldersProperty {
  type: "boolean";
  description: string;
}

export const INCLUDE_SUBFOLDERS_PROPERTY: IncludeSubfoldersProperty = {
  type: "boolean",
  description: "Also include members of sub-groups (default false). A parent group often has no direct members, so set this when a group looks empty.",
};
