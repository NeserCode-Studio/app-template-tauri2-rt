import type { Permission } from "@/application/types";

const RANK: Record<Permission, number> = {
  read: 0,
  write: 1,
  admin: 2,
};

export function canUsePermission(
  granted: Permission,
  required: Permission
): boolean {
  return RANK[granted] >= RANK[required];
}

export function isPermission(value: unknown): value is Permission {
  return value === "read" || value === "write" || value === "admin";
}
