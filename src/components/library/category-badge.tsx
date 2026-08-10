import { Badge } from "@/components/ui/badge";

import { categoryVariant, type CategoryLite } from "./library-meta";

/**
 * Renders a file's authoritative filing (`library_files.category_id`, docs/12
 * §2.2) as a coloured pill. A null category — a file not yet filed by a human —
 * renders as a muted "Uncategorized", never as the AI's guess: the machine's
 * suggestion lives only in `ai_suggested_category_id` and is shown separately in
 * the review queue (docs/12 §4.3).
 */
export function CategoryBadge({
  category,
}: {
  category: CategoryLite | null | undefined;
}) {
  if (!category) {
    return <Badge variant="muted">Uncategorized</Badge>;
  }
  return <Badge variant={categoryVariant(category.slug)}>{category.name}</Badge>;
}
