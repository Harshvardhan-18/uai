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

  return true;
}

/**
 * Get reason message when access is denied
 */
export function getAccessDeniedMessage(user: User, toolName: string): string {
  return `[Gateway Forbidden] Role '${user.role}' is not authorized to execute '${toolName}'. Required role: 'admin'.`;
}
