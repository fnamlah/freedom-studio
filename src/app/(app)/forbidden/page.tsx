import type { Metadata } from "next";

import { ForbiddenView } from "@/components/ui/forbidden";
import { isRole, roleLabel } from "@/lib/auth/roles";
import { getDict, getLocale } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDict()).authFlow.forbiddenMetaTitle };
}

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
  const locale = await getLocale();

  const labels = (required ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(isRole)
    .map((role) => roleLabel(locale, role));

  return <ForbiddenView requiredRoles={labels.length > 0 ? labels : undefined} />;
}
