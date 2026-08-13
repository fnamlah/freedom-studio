"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Field, Label } from "@/components/ui/label";
import { Select, type SelectOption } from "@/components/ui/select";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { useDict, useLocale } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/format";

import { mintPairingCode, unpairChannel } from "./actions";

/**
 * Telegram access (migration 015) — Super Admin only, like the page it sits on.
 *
 * Pairing used to be a hand-written SQL insert, which is why the studio's
 * second Super Admin never got a channel: there was simply no path. This is
 * that path.
 *
 * The minted code is rendered ONCE and never re-fetched. It is not a password
 * — it expires, it is single-use, and it is pinned to a Telegram username, so
 * it is inert in anyone else's hands — but showing it again on a later page
 * load would turn a transient hand-off into a stored credential.
 */

export type PairedChannelView = {
  id: string;
  personName: string;
  roleLabel: string;
  chatId: string;
  pairedAt: string;
};

export function PairingPanel({
  channels,
  peopleOptions,
}: {
  channels: PairedChannelView[];
  /** Bot-eligible, active profiles — the only accounts the bot will accept. */
  peopleOptions: SelectOption[];
}) {
  const d = useDict();
  const fm = fmt(useLocale());
  const t = d.adminAi.hermes.pairing;
  const router = useRouter();
  const { success, error } = useToast();
  const [isRunning, startTransition] = useTransition();

  const [profileId, setProfileId] = useState("");
  const [username, setUsername] = useState("");
  const [days, setDays] = useState("7");
  const [minted, setMinted] = useState<{ code: string; username: string; expiresAt: string } | null>(
    null,
  );
  const [copied, setCopied] = useState(false);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const result = await mintPairingCode({
        profile_id: profileId,
        telegram_username: username,
        days: Number(days),
      });
      if (result.ok) {
        setMinted({ code: result.code, username: result.username, expiresAt: result.expiresAt });
        setCopied(false);
        setProfileId("");
        setUsername("");
        success(t.mintToastOk);
        router.refresh();
      } else {
        error(t.mintToastErr, result.error);
      }
    });
  }

  function revoke(channelId: string) {
    startTransition(async () => {
      const result = await unpairChannel({ channel_id: channelId });
      if (result.ok) {
        success(t.unpairToastOk, result.message);
        router.refresh();
      } else {
        error(t.unpairToastErr, result.error);
      }
    });
  }

  async function copyCode() {
    if (!minted) return;
    try {
      await navigator.clipboard.writeText(minted.code);
      setCopied(true);
    } catch {
      // Clipboard can be blocked; the code is on screen to read either way.
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {channels.length === 0 ? (
        <EmptyState title={t.emptyTitle} description={t.emptyDescription} />
      ) : (
        <Table containerClassName="rounded-lg border border-border">
          <THead>
            <TR>
              <TH>{t.colPerson}</TH>
              <TH>{t.colRole}</TH>
              <TH>{t.colChat}</TH>
              <TH>{t.colPaired}</TH>
              <TH align="right">
                <span className="sr-only">{d.common.actions}</span>
              </TH>
            </TR>
          </THead>
          <TBody>
            {channels.map((c) => (
              <TR key={c.id}>
                <TD className="font-medium text-foreground">{c.personName}</TD>
                <TD>
                  <Badge variant="neutral">{c.roleLabel}</Badge>
                </TD>
                <TD className="text-muted tabular-nums">{c.chatId}</TD>
                <TD className="text-muted whitespace-nowrap">{fm.date(c.pairedAt)}</TD>
                <TD align="right">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={isRunning}
                    onClick={() => revoke(c.id)}
                  >
                    {t.unpair}
                  </Button>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      <form onSubmit={submit} className="flex flex-col gap-4 rounded-lg border border-border p-4">
        <h3 className="text-sm font-medium text-foreground">{t.mintTitle}</h3>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field help={t.mintPersonHelp}>
            <Label htmlFor="pair-person" required>
              {t.mintPerson}
            </Label>
            <Select
              id="pair-person"
              required
              placeholder={t.mintPersonPlaceholder}
              options={peopleOptions}
              value={profileId}
              onChange={(e) => setProfileId(e.target.value)}
            />
          </Field>

          <Field help={t.mintUsernameHelp}>
            <Label htmlFor="pair-username" required>
              {t.mintUsername}
            </Label>
            <Input
              id="pair-username"
              required
              placeholder="@freedom_curator"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </Field>

          <Field>
            <Label htmlFor="pair-days" required>
              {t.mintDays}
            </Label>
            <Input
              id="pair-days"
              type="number"
              min={1}
              max={30}
              required
              value={days}
              onChange={(e) => setDays(e.target.value)}
            />
          </Field>
        </div>

        <div>
          <Button type="submit" loading={isRunning}>
            {t.mintSubmit}
          </Button>
        </div>

        {minted ? (
          <div className="rounded-md border border-success/30 bg-success/10 px-3 py-3">
            <p className="text-sm font-medium text-foreground">{t.resultTitle}</p>
            <p className="mt-1 text-xs text-muted">{t.resultBody(minted.username)}</p>
            <div className="mt-2 flex items-center gap-2">
              <code className="rounded bg-surface px-2 py-1 font-mono text-sm text-foreground">
                {minted.code}
              </code>
              <Button type="button" variant="outline" size="sm" onClick={copyCode}>
                {copied ? t.copied : t.copy}
              </Button>
            </div>
            <p className="mt-2 text-xs text-muted">
              {t.resultExpires(fm.date(minted.expiresAt))} {t.resultBotHint}
            </p>
          </div>
        ) : null}
      </form>
    </div>
  );
}
