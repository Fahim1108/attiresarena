import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Design-system className merger (clsx + tailwind-merge).
 *
 * This is the ONLY cn() the design-system namespace uses. It lives here —
 * not in src/lib — because src/lib edits are out of scope for the
 * design-system setup, and it must not be confused with the tiny joiner in
 * src/lib/cn.ts, which existing components keep using unchanged.
 *
 * Import from "@/design-system/cn" (see components.json `utils` alias).
 * Prefer direct imports over barrels (react_best_practices
 * bundle-barrel-imports).
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
