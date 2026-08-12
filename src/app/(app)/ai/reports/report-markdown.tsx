import type { ReactNode } from "react";

/**
 * A deliberately small, dependency-free Markdown renderer for stored report
 * bodies (`ai_reports.content_md`). It parses the subset the report prompt asks
 * for — headings, bullet lists, bold spans and paragraphs — into React elements.
 *
 * Crucially it renders text as React *nodes* (never `dangerouslySetInnerHTML`),
 * so model-authored content cannot inject markup: every string is escaped by
 * React. Anything it does not recognize falls through as a plain paragraph.
 *
 * LANGUAGE-INDEPENDENT BY CONSTRUCTION. The report prompt
 * (`./actions.ts` → `systemPromptFor`) asks for its five section headings in the
 * reader's language, so the heading TEXT differs per locale and changes again
 * whenever that prompt is reworded. Nothing here may therefore match on heading
 * text: `parseBlocks` keys on the `#` markers and the `-`/`*` bullets alone,
 * which are identical in every language. Introducing a heading-text check would
 * silently blank every report written in the other language — do not add one.
 */
export function ReportMarkdown({ content }: { content: string }) {
  const blocks = parseBlocks(content);
  return (
    <div className="flex flex-col gap-3 text-sm leading-relaxed text-foreground">
      {blocks.map((block, i) => renderBlock(block, i))}
    </div>
  );
}

type Block =
  | { kind: "heading"; level: 2 | 3 | 4; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "paragraph"; text: string };

function parseBlocks(md: string): Block[] {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ kind: "paragraph", text: paragraph.join(" ").trim() });
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list.length > 0) {
      blocks.push({ kind: "list", items: list });
      list = [];
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (trimmed === "") {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flushParagraph();
      flushList();
      const hashes = heading[1].length;
      const level = hashes <= 2 ? 2 : hashes === 3 ? 3 : 4;
      blocks.push({ kind: "heading", level, text: heading[2].trim() });
      continue;
    }

    const bullet = /^[-*]\s+(.*)$/.exec(trimmed);
    if (bullet) {
      flushParagraph();
      list.push(bullet[1].trim());
      continue;
    }

    flushList();
    paragraph.push(trimmed);
  }
  flushParagraph();
  flushList();
  return blocks;
}

function renderBlock(block: Block, key: number): ReactNode {
  if (block.kind === "heading") {
    const className =
      block.level === 2
        ? "text-base font-semibold text-foreground"
        : "text-sm font-semibold text-foreground";
    if (block.level === 2) return <h3 key={key} className={className}>{renderInline(block.text)}</h3>;
    if (block.level === 3) return <h4 key={key} className={className}>{renderInline(block.text)}</h4>;
    return <h5 key={key} className={className}>{renderInline(block.text)}</h5>;
  }
  if (block.kind === "list") {
    return (
      <ul key={key} className="ml-4 list-disc space-y-1 text-muted">
        {block.items.map((item, i) => (
          <li key={i}>{renderInline(item)}</li>
        ))}
      </ul>
    );
  }
  return (
    <p key={key} className="text-muted">
      {renderInline(block.text)}
    </p>
  );
}

/** Render inline `**bold**` spans; everything else stays plain (React-escaped). */
function renderInline(text: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter((p) => p !== "");
  return parts.map((part, i) => {
    const bold = /^\*\*([^*]+)\*\*$/.exec(part);
    if (bold) {
      return (
        <strong key={i} className="font-semibold text-foreground">
          {bold[1]}
        </strong>
      );
    }
    return <span key={i}>{part}</span>;
  });
}
