import { User } from "../types/index.js";

/**
 * Tools restricted to administrative users.
 * Regular members will not see these tools in tools/list,
 * and any attempt to call them will be rejected with an immediate error.
 */
export const ADMIN_ONLY_TOOLS = new Set<string>([
  "woo__create_product",
  "woo__update_order_status",
]);

/**
 * Tools that perform write / mutating operations.
 * Require human-in-the-loop confirmation when requireWriteConfirmation is enabled.
 */
export const WRITE_TOOLS = new Set<string>([
  "woo__create_product",
  "woo__update_order_status",
]);

export function isWriteTool(toolName: string): boolean {
  if (WRITE_TOOLS.has(toolName)) return true;
  const lower = toolName.toLowerCase();
  return (
    lower.includes("create_") ||
    lower.includes("update_") ||
    lower.includes("delete_") ||
    lower.includes("set_") ||
    lower.includes("write_") ||
    lower.includes("cancel_") ||
    lower.includes("modify_")
  );
}

/**
 * Default allowed server slugs for regular members.
 * New servers default to admin-only until explicitly enabled by an admin.
 */
export const memberAllowedServerSlugs = new Set<string>([
  "woo",
  "utils",
  "everything",
]);

export function setMemberAllowedServers(slugs: string[]) {
  memberAllowedServerSlugs.clear();
  for (const s of slugs) {
    memberAllowedServerSlugs.add(s);
  }
}

export function allowServerForMembers(slug: string) {
  memberAllowedServerSlugs.add(slug);
}

export function disallowServerForMembers(slug: string) {
  memberAllowedServerSlugs.delete(slug);
}

/**
 * Check if a user role is permitted to discover and execute a given tool.
 */
export function canUserAccessTool(user: User, toolName: string): boolean {
  if (user.role === "admin") {
    return true; // Admins have unrestricted access
  }

  // Members cannot access administrative tools
  if (ADMIN_ONLY_TOOLS.has(toolName)) {
    return false;
  }

  // New servers default to admin-only unless explicitly allowed for members
  const slug = toolName.includes("__") ? toolName.split("__")[0] : "";
  if (slug && !memberAllowedServerSlugs.has(slug)) {
    return false;
  }

  return true;
}

/**
 * Get reason message when access is denied
 */
export function getAccessDeniedMessage(user: User, toolName: string): string {
  return `[Gateway Forbidden] Role '${user.role}' is not authorized to execute '${toolName}'. Required role: 'admin'.`;
}
