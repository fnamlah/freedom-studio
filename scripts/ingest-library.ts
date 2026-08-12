/**
 * One-off bulk ingestion of the studio's training corpus into the Library.
 *
 * Run from the repo root:  npx tsx scripts/ingest-library.ts
 *
 * This deliberately mirrors the app's own two steps rather than inventing a
 * third path: (1) the upload conventions of src/app/(app)/library/actions.ts
 * (bucket `library`, key `${uuid}/${safeName}`, sha256, uploaded_by = a real
 * profile), and (2) the classify persistence of src/app/api/ai/classify/route.ts
 * (classifyFile → write suggestion + ai.classify audit + ai_usage metering).
 * The provider crossing itself stays inside classifyFile, which uses the
 * documented classificationChannel — no new egress path is created here.
 *
 * Idempotent: files whose sha256 already exists in library_files are skipped,
 * so re-running after a partial failure never duplicates rows.
 */
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

/* ------------------------------------------------------------- env ------ */
// Load .env.local BEFORE importing any app module (settings/audit read env).
{
  const envFile = readFileSync(path.join(process.cwd(), ".env.local"), "utf8");
  for (const line of envFile.split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && process.env[m[1]!] === undefined) {
      process.env[m[1]!] = m[2]!.replace(/^"(.*)"$/, "$1");
    }
  }
  process.env.SUPABASE_URL ??= process.env.NEXT_PUBLIC_SUPABASE_URL;
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("missing Supabase env");

/** The human this ingestion is attributed to (Faisal, super_admin). */
const UPLOADER_ID = "1d0d837a-8731-4490-b938-7a14ac124767";

const DL = "/Users/faisalalnamlah/Downloads";
const PAGES_EXPORT =
  "/private/tmp/claude-501/-Users-faisalalnamlah-Desktop/73301b89-7c18-4a00-8a4d-46e68223c7e2/scratchpad/pages-export/скрипты фри чат.pdf";

const MIME: Record<string, string> = {
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

interface Item {
  /** Absolute path of the bytes to upload. */
  src: string;
  /** Display name in the Library (may differ from src when converted/renamed). */
  name: string;
  folder: string;
  /** Override when the extension lies about the real format. */
  mime?: string;
  note?: string;
}

const PLATFORMS = "/Training/Platforms";
const SCRIPTS = "/Training/Scripts";

const ITEMS: Item[] = [
  { src: `${DL}/По сайтам/Plasma streaming.pdf`, name: "Plasma streaming.pdf", folder: PLATFORMS },
  {
    src: `${DL}/По сайтам/Инструкция_ как подключить SkyPrivate Chat.docx`,
    name: "Инструкция_ как подключить SkyPrivate Chat.docx",
    folder: PLATFORMS,
  },
  { src: `${DL}/По сайтам/Лента стрипчата.pdf`, name: "Лента стрипчата.pdf", folder: PLATFORMS },
  {
    // file(1): actually PowerPoint 2007+ wearing a .pdf extension. Upload under
    // its true type or extraction lands in the wrong branch and fails.
    src: `${DL}/По сайтам/скайприват- обучение.pdf`,
    name: "скайприват- обучение.pptx",
    folder: PLATFORMS,
    mime: MIME[".pptx"],
    note: "renamed from .pdf — real format is pptx",
  },
  {
    src: `${DL}/По сайтам/Успешеный запуск STRIPCHAT.pdf`,
    name: "Успешеный запуск STRIPCHAT.pdf",
    folder: PLATFORMS,
  },
  ...[
    "Chastity_Cage_Инструкция_по_применению.docx",
    "FOOTFETISH Инструкция по применению.docx",
    "JOI 3 для рабов.txt",
    "JOI and CEI.docx",
    "JOI.docx",
    "JOII новые идеи.docx",
    "Sissy Подробная инструкция.docx",
    "Tease and denial Применение.docx",
    "Кинки и фетиши Общее.docx",
    "СBT IDEAS.docx",
    "Слова и фразы(для новеньких).docx",
    "Унизительные слова и фразы.txt",
    "Фразы для госпожи.txt",
  ].map((n) => ({ src: `${DL}/Скрипты-фетиши/${n}`, name: n, folder: SCRIPTS })),
  {
    // Apple .pages has no extractable text without Pages itself; ingested as
    // the PDF exported from Pages.app 14.4 on this machine.
    src: PAGES_EXPORT,
    name: "скрипты фри чат.pdf",
    folder: SCRIPTS,
    note: "converted from скрипты фри чат.pages via Pages.app export",
  },
];

/**
 * Verbatim copy of sanitizeFilename from library/actions.ts:78. Supabase
 * Storage rejects keys outside a narrow ASCII charset, so Cyrillic collapses
 * to underscores here — which is why the DISPLAY name stored on the row is
 * the ORIGINAL filename, exactly as the app's upload action does (displayName
 * vs safeName). The first run used one name for both and all 16
 * Cyrillic-named files failed with "Invalid key".
 */
function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  const cleaned = base
    .normalize("NFKC")
    .replace(/[^\w.\- ]+/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[_.]+/, "")
    .slice(0, 180);
  return cleaned.length > 0 ? cleaned : "file";
}

async function main() {
  // App modules import AFTER env is in place.
  const { createClient } = await import("@supabase/supabase-js");
  const { classifyFile } = await import("../src/lib/ai/classify.js");
  const { writeAudit } = await import("../src/lib/audit.js");
  const { recordUsage } = await import("../src/lib/ai/budget.js");
  type DB = import("../src/lib/database.types.js").Database;

  const db = createClient<DB>(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: trainingCat, error: catErr } = await db
    .from("doc_categories")
    .select("id, slug, ai_enabled")
    .eq("slug", "training")
    .single();
  if (catErr || !trainingCat?.ai_enabled) throw new Error("training category missing/disabled");

  const actor = { id: UPLOADER_ID, role: "super_admin" as const };
  const settings = { "ai.classify.max_file_mb": 50 };
  const results: Array<{ name: string; outcome: string }> = [];

  for (const item of ITEMS) {
    const bytes = readFileSync(item.src);
    const sha256 = createHash("sha256").update(bytes).digest("hex");

    // Idempotency: same bytes already ingested → skip.
    const { data: dupe } = await db
      .from("library_files")
      .select("id, name")
      .eq("sha256", sha256)
      .maybeSingle();
    if (dupe) {
      results.push({ name: item.name, outcome: `already ingested as ${dupe.name}` });
      continue;
    }

    const mime = item.mime ?? MIME[path.extname(item.name).toLowerCase()];
    if (!mime) throw new Error(`no mime mapping for ${item.name}`);

    const fileId = randomUUID();
    const safeName = sanitizeFilename(item.name);
    const storagePath = `${fileId}/${safeName}`;

    const { error: upErr } = await db.storage
      .from("library")
      .upload(storagePath, bytes, { contentType: mime, upsert: false });
    if (upErr) {
      results.push({ name: item.name, outcome: `UPLOAD FAILED: ${upErr.message}` });
      continue;
    }

    const { data: row, error: insErr } = await db
      .from("library_files")
      .insert({
        id: fileId,
        folder_path: item.folder,
        name: item.name,
        mime_type: mime,
        size_bytes: bytes.byteLength,
        storage_path: storagePath,
        sha256,
        category_id: trainingCat.id,
        ai_exempt: false,
        ai_status: "pending",
        uploaded_by: UPLOADER_ID,
      })
      .select("*")
      .single();

    if (insErr || !row) {
      // Same rollback the app performs: never leave an orphan object.
      await db.storage.from("library").remove([storagePath]);
      results.push({ name: item.name, outcome: `INSERT FAILED: ${insErr?.message}` });
      continue;
    }

    await writeAudit({
      action: "library.upload",
      entityType: "library_file",
      entityId: fileId,
      metadata: {
        name: item.name,
        folder_path: item.folder,
        mime_type: mime,
        size_bytes: bytes.byteLength,
        via: "bulk_ingest_script",
        ...(item.note ? { note: item.note } : {}),
      },
      actor,
    });

    // ---- classification (mirrors route.ts applyResult) ----
    const s = await classifyFile({ file: row, supabase: db, settings });
    const now = new Date().toISOString();

    if (s.status === "suggested") {
      await db
        .from("library_files")
        .update({
          ai_status: "suggested",
          ai_suggested_category_id: s.categoryId,
          ai_confidence: s.confidence,
          ai_rationale: s.rationale,
          ai_summary: s.summary || null,
          ai_key_figures: s.keyFigures.length ? s.keyFigures : null,
          classified_at: now,
          classified_provider: s.provider,
        })
        .eq("id", fileId);
      await writeAudit({
        action: "ai.classify",
        entityType: "library_file",
        entityId: fileId,
        metadata: {
          outcome: "suggested",
          provider: s.provider,
          model: s.model,
          mime_type: mime,
          size_bytes: bytes.byteLength,
          category_slug: s.categorySlug,
          confidence: s.confidence,
        },
        actor,
      });
      await recordUsage(
        {
          userId: UPLOADER_ID,
          requestKind: "classify",
          provider: s.provider,
          model: s.model,
          promptTokens: s.usage.promptTokens,
          completionTokens: s.usage.completionTokens,
          status: "ok",
        },
        db,
      );
      results.push({
        name: item.name,
        outcome: `classified → ${s.categorySlug} (${Math.round(s.confidence * 100)}%), summary ${s.summary?.length ?? 0} chars`,
      });
    } else if (s.status === "skipped") {
      await db
        .from("library_files")
        .update({ ai_status: "skipped", classified_at: now })
        .eq("id", fileId);
      results.push({ name: item.name, outcome: `stored; classification skipped (${s.reason})` });
    } else {
      await db
        .from("library_files")
        .update({ ai_status: "failed", classified_at: now, classified_provider: s.provider ?? null })
        .eq("id", fileId);
      if (s.provider) {
        await writeAudit({
          action: "ai.classify",
          entityType: "library_file",
          entityId: fileId,
          metadata: {
            outcome: "failed",
            reason: s.reason,
            provider: s.provider,
            model: s.model,
            mime_type: mime,
            size_bytes: bytes.byteLength,
          },
          actor,
        });
        await recordUsage(
          {
            userId: UPLOADER_ID,
            requestKind: "classify",
            provider: s.provider,
            model: s.model ?? "unknown",
            promptTokens: s.usage?.promptTokens ?? 0,
            completionTokens: s.usage?.completionTokens ?? 0,
            status: "error",
          },
          db,
        );
      }
      results.push({
        name: item.name,
        outcome: `stored; classification FAILED (${s.reason}${s.message ? `: ${s.message}` : ""})`,
      });
    }
  }

  console.log("\n=== INGESTION REPORT ===");
  for (const r of results) console.log(`• ${r.name} — ${r.outcome}`);
  const ok = results.filter((r) => r.outcome.startsWith("classified")).length;
  console.log(`\n${results.length} processed, ${ok} classified with summaries.`);
}

main().catch((e) => {
  console.error("INGESTION ABORTED:", e);
  process.exit(1);
});
