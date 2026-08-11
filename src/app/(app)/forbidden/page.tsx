import type { Metadata } from "next";

import { ForbiddenView } from "@/components/ui/forbidden";
import { isRole, ROLE_LABELS } from "@/lib/auth/roles";

export const metadata: Metadata = { title: "Not available" };

/**
 * Destination of `requireRole()` when the caller's role is not permitted.
 *
 * The `required` query parameter is a display hint only — it is validated
 * against the known role set so an attacker cannot inject arbitrary text here.
 */
export default async function ForbiddenPage({
  searchParams,
}: {
  searchParams: Promise<{ required?: string }>;
}) {
  const { required } = await searchParams;

  const labels = (required ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(isRole)
    .map((role) => ROLE_LABELS[role]);

  return <ForbiddenView requiredRoles={labels.length > 0 ? labels : undefined} />;
}
