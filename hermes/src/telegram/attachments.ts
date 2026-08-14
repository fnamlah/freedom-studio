/**
 * The file waiting to be filed, per chat.
 *
 * In memory, 15-minute TTL, and CONSUMED on use — an adversarial review caught
 * the version without consumption: a passport sent at 10:00 and never filed
 * was still sitting here at 10:10 when Alina said "save this as Vera's
 * contract" about a file that never arrived, and an honest-looking card filed
 * the wrong person's identity document. Now a successful proposal takes the
 * attachment off the shelf, and the card names the file and its age so the
 * approver can catch a mismatch the code cannot.
 *
 * A worker restart drops the map — the bot then asks for the file again,
 * which is the honest degradation for a single-worker deployment. Only the
 * file_id is ever held; bytes move exclusively inside the executor, after a
 * tap.
 */

export interface PendingAttachment {
  fileId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  receivedAt: number;
}

const TTL_MS = 15 * 60_000;
const pending = new Map<string, PendingAttachment>();

/**
 * A mime type is SENDER-CONTROLLED text. Everything else in the attachment
 * note is derived (size) or withheld (name), but the mime crosses to the AI
 * provider verbatim inside the note — so it is shape-checked here, at the
 * door, and anything weird becomes the honest unknown.
 */
const MIME_RE = /^[\w.+-]{1,64}\/[\w.+-]{1,64}$/;
export function safeMime(raw: string | undefined): string {
  return raw && MIME_RE.test(raw) ? raw : "application/octet-stream";
}

export function rememberAttachment(
  chatId: number | string,
  att: Omit<PendingAttachment, "receivedAt">,
): void {
  pending.set(String(chatId), { ...att, receivedAt: Date.now() });
}

export function recallAttachment(chatId: number | string): PendingAttachment | undefined {
  const held = pending.get(String(chatId));
  if (!held) return undefined;
  if (Date.now() - held.receivedAt > TTL_MS) {
    pending.delete(String(chatId));
    return undefined;
  }
  return held;
}

/** Take the attachment off the shelf — called when a proposal consumed it. */
export function consumeAttachment(chatId: number | string): void {
  pending.delete(String(chatId));
}
