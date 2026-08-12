"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Field, Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { EM_DASH, truncate } from "@/lib/format";
import { useDict, useLocale } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/format";

import {
  createShare,
  listShareViews,
  listShares,
  revokeShare,
  type ShareListItem,
  type ShareViewItem,
} from "./actions";
import { SHARE_STATUS_META, deriveShareStatus } from "./doc-meta";

/** Tomorrow (UTC) as `YYYY-MM-DD` — the earliest an expiry may be set. */
function tomorrowIso(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

type CreateFields = { expires_date: string; max_views: string; recipient_label: string };
const EMPTY_CREATE: CreateFields = { expires_date: "", max_views: "", recipient_label: "" };

/**
 * Share-link manager for a single document (SA/MGR only).
 *
 * Create → the raw token URL is shown ONCE here, in the response, and never
 * again: only its SHA-256 hash and prefix are stored (docs/06 §5.1–5.2). List,
 * revoke, and inspect the anonymous view audit (docs/06 §5.5, §6). Every action
 * re-guards SA/MGR on the server and is audited.
 */
export function ShareManager({
  documentId,
  documentTitle,
}: {
  documentId: string;
  documentTitle: string;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const d = useDict();
  const fm = fmt(useLocale());
  const s = d.documents.shares;

  const [open, setOpen] = useState(false);
  const [shares, setShares] = useState<ShareListItem[] | null>(null);
  const [loadingShares, setLoadingShares] = useState(false);

  const [createForm, setCreateForm] = useState<CreateFields>(EMPTY_CREATE);
  const [creating, setCreating] = useState(false);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [revokingId, setRevokingId] = useState<string | null>(null);

  const [auditShareId, setAuditShareId] = useState<string | null>(null);
  const [auditViews, setAuditViews] = useState<ShareViewItem[] | null>(null);
  const [loadingAudit, setLoadingAudit] = useState(false);

  const minDate = tomorrowIso();

  useEffect(() => {
    if (!open) return;
    setCreateForm(EMPTY_CREATE);
    setCreatedUrl(null);
    setCopied(false);
    setAuditShareId(null);
    setAuditViews(null);
    void refreshShares();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function refreshShares() {
    setLoadingShares(true);
    const res = await listShares(documentId);
    setLoadingShares(false);
    if (res.ok) {
      setShares(res.shares);
    } else {
      setShares([]);
      error(s.loadFailedTitle, res.error);
    }
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreating(true);
    const res = await createShare({
      document_id: documentId,
      expires_date: createForm.expires_date,
      max_views: createForm.max_views,
      recipient_label: createForm.recipient_label,
    });
    setCreating(false);
    if (res.ok) {
      setCreatedUrl(res.url);
      setCopied(false);
      setCreateForm(EMPTY_CREATE);
      success(s.createdTitle, res.message);
      void refreshShares();
      router.refresh();
    } else {
      error(s.createFailedTitle, res.error);
    }
  }

  async function revoke(id: string) {
    setRevokingId(id);
    const res = await revokeShare({ id });
    setRevokingId(null);
    if (res.ok) {
      success(s.revokedTitle, res.message);
      void refreshShares();
      router.refresh();
    } else {
      error(s.revokeFailedTitle, res.error);
    }
  }

  async function toggleAudit(id: string) {
    if (auditShareId === id) {
      setAuditShareId(null);
      setAuditViews(null);
      return;
    }
    setAuditShareId(id);
    setAuditViews(null);
    setLoadingAudit(true);
    const res = await listShareViews(id);
    setLoadingAudit(false);
    if (res.ok) {
      setAuditViews(res.views);
    } else {
      setAuditViews([]);
      error(s.loadAuditFailedTitle, res.error);
    }
  }

  async function copyUrl() {
    if (!createdUrl) return;
    try {
      await navigator.clipboard.writeText(createdUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      error(s.copyFailedTitle, s.copyFailedBody);
    }
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        {s.cta}
      </Button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={s.title}
        description={s.description(truncate(documentTitle, 60))}
        size="lg"
      >
        <div className="flex flex-col gap-6">
          {/* --------------------------------------------------------- create --- */}
          <form onSubmit={create} className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field help={s.expiresHelp}>
                <Label htmlFor="share-expires" required>
                  {s.expiresLabel}
                </Label>
                <Input
                  id="share-expires"
                  type="date"
                  required
                  min={minDate}
                  value={createForm.expires_date}
                  onChange={(e) =>
                    setCreateForm((p) => ({ ...p, expires_date: e.target.value }))
                  }
                />
              </Field>

              <Field help={s.maxViewsHelp}>
                <Label htmlFor="share-max-views">{s.maxViewsLabel}</Label>
                <Input
                  id="share-max-views"
                  type="number"
                  min={1}
                  step={1}
                  inputMode="numeric"
                  placeholder={s.maxViewsPlaceholder}
                  value={createForm.max_views}
                  onChange={(e) =>
                    setCreateForm((p) => ({ ...p, max_views: e.target.value }))
                  }
                />
              </Field>

              <Field help={s.recipientHelp}>
                <Label htmlFor="share-recipient">{s.recipientLabel}</Label>
                <Input
                  id="share-recipient"
                  maxLength={120}
                  placeholder={s.recipientPlaceholder}
                  value={createForm.recipient_label}
                  onChange={(e) =>
                    setCreateForm((p) => ({ ...p, recipient_label: e.target.value }))
                  }
                />
              </Field>
            </div>
            <div className="flex justify-end">
              <Button type="submit" size="sm" loading={creating}>
                {s.createCta}
              </Button>
            </div>
          </form>

          {/* -------------------------------------------- one-time raw token --- */}
          {createdUrl ? (
            <div className="rounded-lg border border-warning/30 bg-warning/10 p-3">
              <p className="text-xs font-medium text-warning">{s.onceWarning}</p>
              <div className="mt-2 flex items-center gap-2">
                <Input
                  readOnly
                  value={createdUrl}
                  onFocus={(e) => e.currentTarget.select()}
                  className="font-mono text-xs"
                />
                <Button size="sm" variant="secondary" onClick={copyUrl}>
                  {copied ? s.copied : s.copy}
                </Button>
              </div>
            </div>
          ) : null}

          {/* ------------------------------------------------------- list --- */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-medium text-foreground">{s.existing}</h3>
              {loadingShares ? <Spinner size="sm" /> : null}
            </div>

            {shares && shares.length === 0 && !loadingShares ? (
              <EmptyState bare title={s.emptyTitle} description={s.emptyDescription} />
            ) : shares && shares.length > 0 ? (
              <Table containerClassName="rounded-lg border border-border">
                <THead>
                  <TR>
                    <TH>{s.colLink}</TH>
                    <TH>{s.colRecipient}</TH>
                    <TH>{s.colExpires}</TH>
                    <TH align="right">{s.colViews}</TH>
                    <TH>{d.common.status}</TH>
                    <TH align="right">{d.common.actions}</TH>
                  </TR>
                </THead>
                <TBody>
                  {shares.map((share) => {
                    const status = deriveShareStatus(share);
                    const meta = SHARE_STATUS_META[status];
                    const auditOpen = auditShareId === share.id;
                    return (
                      <TR key={share.id}>
                        <TD className="font-mono text-xs text-muted">{share.token_prefix}…</TD>
                        <TD className="text-muted">{share.recipient_label ?? EM_DASH}</TD>
                        <TD className="text-muted">{fm.date(share.expires_at)}</TD>
                        <TD numeric>
                          {s.views(
                            fm.number(share.view_count),
                            share.max_views !== null ? fm.number(share.max_views) : null,
                          )}
                        </TD>
                        <TD>
                          <Badge variant={meta.variant} dot>
                            {d.documents.shareStatus[status]}
                          </Badge>
                        </TD>
                        <TD align="right">
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => toggleAudit(share.id)}
                            >
                              {auditOpen ? s.hideAudit : s.audit}
                            </Button>
                            {status === "active" ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                loading={revokingId === share.id}
                                onClick={() => revoke(share.id)}
                              >
                                {s.revoke}
                              </Button>
                            ) : null}
                          </div>
                        </TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            ) : null}
          </div>

          {/* ------------------------------------------------------ audit --- */}
          {auditShareId ? (
            <div className="rounded-lg border border-border bg-surface-2/40 p-3">
              <h4 className="mb-2 text-xs font-medium text-foreground">{s.auditHeading}</h4>
              {loadingAudit ? (
                <div className="flex justify-center py-3">
                  <Spinner size="sm" />
                </div>
              ) : auditViews && auditViews.length > 0 ? (
                <Table>
                  <THead>
                    <TR>
                      <TH>{s.colViewed}</TH>
                      <TH>{s.colUserAgent}</TH>
                      <TH>{s.colIpHash}</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {auditViews.map((view) => (
                      <TR key={view.id}>
                        <TD className="whitespace-nowrap text-muted">
                          {fm.dateTime(view.viewed_at)}
                        </TD>
                        <TD className="text-muted">
                          {truncate(view.user_agent ?? EM_DASH, 60)}
                        </TD>
                        <TD className="font-mono text-xs text-muted">
                          {view.ip_hash ? `${view.ip_hash.slice(0, 12)}…` : EM_DASH}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              ) : (
                <p className="py-2 text-xs text-muted">{s.noViews}</p>
              )}
            </div>
          ) : null}
        </div>
      </Dialog>
    </>
  );
}
