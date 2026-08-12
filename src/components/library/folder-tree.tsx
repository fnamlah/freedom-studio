"use client";

import { useDict } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

import type { FolderNode } from "./library-meta";

/**
 * Virtual-folder navigator (docs/12 §1). The tree is DERIVED from the files'
 * `folder_path` values — there is no folders table — so it always reflects
 * exactly what is filed. Selecting a folder scopes the grid to that folder and
 * its descendants; the root `/` ("All files") shows everything.
 */
export function FolderTree({
  root,
  selected,
  onSelect,
}: {
  root: FolderNode;
  selected: string;
  onSelect: (path: string) => void;
}) {
  const d = useDict();

  return (
    <nav aria-label={d.library.folders} className="flex flex-col gap-0.5 text-sm">
      <FolderRow node={root} selected={selected} onSelect={onSelect} />
    </nav>
  );
}

function FolderRow({
  node,
  selected,
  onSelect,
}: {
  node: FolderNode;
  selected: string;
  onSelect: (path: string) => void;
}) {
  const isSelected = selected === node.path;

  return (
    <>
      <button
        type="button"
        onClick={() => onSelect(node.path)}
        aria-current={isSelected ? "true" : undefined}
        className={cn(
          "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
          "outline-none focus-visible:ring-2 focus-visible:ring-primary",
          isSelected
            ? "bg-primary/15 text-foreground"
            : "text-muted hover:bg-surface-2 hover:text-foreground",
        )}
        style={{ paddingLeft: `${0.5 + node.depth * 0.85}rem` }}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <FolderIcon />
          <span className="truncate">{node.name}</span>
        </span>
        <span className="shrink-0 text-xs tabular-nums text-muted">{node.totalCount}</span>
      </button>
      {node.children.map((child) => (
        <FolderRow key={child.path} node={child} selected={selected} onSelect={onSelect} />
      ))}
    </>
  );
}

function FolderIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4 shrink-0"
    >
      <path d="M4 20h16a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1h-7.9a1 1 0 0 1-.8-.4l-1.1-1.5a1 1 0 0 0-.8-.4H4a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1Z" />
    </svg>
  );
}
