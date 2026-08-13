/**
 * Tiny, dependency-free UI utilities shared by every component in the kit.
 */

export type ClassValue =
  | string
  | number
  | null
  | false
  | undefined
  | ClassValue[]
  | { [key: string]: boolean | null | undefined };

/**
 * Conditional className joiner (a minimal `clsx`). No Tailwind conflict
 * resolution — put the caller-supplied `className` last so it wins by source
 * order, which is how every component in `@/components/ui` is written.
 */
export function cn(...inputs: ClassValue[]): string {
  const out: string[] = [];

  const walk = (value: ClassValue): void => {
    if (!value) return;
    if (typeof value === "string" || typeof value === "number") {
      out.push(String(value));
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (typeof value === "object") {
      for (const [key, enabled] of Object.entries(value)) {
        if (enabled) out.push(key);
      }
    }
  };

  for (const input of inputs) walk(input);
  return out.join(" ");
}

