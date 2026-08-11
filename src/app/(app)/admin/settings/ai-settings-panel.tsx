"use client";

import { useState, useTransition, type FormEvent } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardFooter, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import type { ProviderId } from "@/lib/ai/types";
import { number as fmtNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

import {
  refreshKeyStatus,
  saveAiLimits,
  saveAiModels,
  switchActiveProvider,
} from "./actions";
import {
  PROVIDER_IDS,
  PROVIDER_KEY_ENV,
  PROVIDER_LABELS,
  type AiSettingsSnapshot,
} from "./settings-meta";

type ModelKey =
  | "ai.chat_model.moonshot"
  | "ai.chat_model.zhipu"
  | "ai.vision_model.moonshot"
  | "ai.vision_model.zhipu"
  | "ai.embedding.model";

type LimitKey =
  | "ai.limits.requests_per_user_per_hour"
  | "ai.limits.tokens_per_user_per_day"
  | "ai.limits.tokens_global_per_day";

export function AiSettingsPanel({ snapshot }: { snapshot: AiSettingsSnapshot }) {
  const { success, error } = useToast();

  /* --------------------------------------------------------- provider state --- */
  const [activeProvider, setActiveProvider] = useState<ProviderId>(snapshot.activeProvider);
  const [selectedProvider, setSelectedProvider] = useState<ProviderId>(snapshot.activeProvider);
  const [configured, setConfigured] = useState<Record<ProviderId, boolean>>(snapshot.configured);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [providerPending, startProvider] = useTransition();

  /* ------------------------------------------------------------ model state --- */
  const initialModels: Record<ModelKey, string> = {
    "ai.chat_model.moonshot": snapshot.chatModel.moonshot,
    "ai.chat_model.zhipu": snapshot.chatModel.zhipu,
    "ai.vision_model.moonshot": snapshot.visionModel.moonshot,
    "ai.vision_model.zhipu": snapshot.visionModel.zhipu,
    "ai.embedding.model": snapshot.embeddingModel,
  };
  const [models, setModels] = useState<Record<ModelKey, string>>(initialModels);
  const [modelsBaseline, setModelsBaseline] =
    useState<Record<ModelKey, string>>(initialModels);
  const [modelsPending, startModels] = useTransition();

  /* ------------------------------------------------------------ limit state --- */
  const initialLimits: Record<LimitKey, string> = {
    "ai.limits.requests_per_user_per_hour": String(snapshot.limits.requestsPerUserPerHour),
    "ai.limits.tokens_per_user_per_day": String(snapshot.limits.tokensPerUserPerDay),
    "ai.limits.tokens_global_per_day": String(snapshot.limits.tokensGlobalPerDay),
  };
  const [limits, setLimits] = useState<Record<LimitKey, string>>(initialLimits);
  const [limitsBaseline, setLimitsBaseline] =
    useState<Record<LimitKey, string>>(initialLimits);
  const [limitsPending, startLimits] = useTransition();

  /* ---------------------------------------------------------------- derived --- */
  const activeConfigured = configured[activeProvider];
  const changedModels = (Object.keys(models) as ModelKey[]).filter(
    (k) => models[k].trim() !== modelsBaseline[k],
  );
  const changedLimits = (Object.keys(limits) as LimitKey[]).filter(
    (k) => limits[k].trim() !== limitsBaseline[k],
  );

  /* --------------------------------------------------------------- handlers --- */
  function confirmSwitch() {
    startProvider(async () => {
      const res = await switchActiveProvider({ provider: selectedProvider });
      if (res.ok) {
        success("Provider switched", res.message);
        setActiveProvider(selectedProvider);
        setConfirmOpen(false);
      } else {
        error("Switch failed", res.error);
      }
    });
  }

  function recheckKeys() {
    startProvider(async () => {
      const res = await refreshKeyStatus();
      if (res.ok) {
        setConfigured(res.status.configured);
        setActiveProvider(res.status.active);
        setSelectedProvider(res.status.active);
        success("Key status refreshed");
      } else {
        error("Could not refresh", res.error);
      }
    });
  }

  function onSaveModels(event: FormEvent) {
    event.preventDefault();
    if (changedModels.length === 0) return;
    const values: Partial<Record<ModelKey, string>> = {};
    for (const key of changedModels) values[key] = models[key].trim();

    startModels(async () => {
      const res = await saveAiModels({ values });
      if (res.ok) {
        success("Saved", res.message);
        setModels((prev) => ({ ...prev, ...values }));
        setModelsBaseline((prev) => ({ ...prev, ...values }));
      } else {
        error("Could not save", res.error);
      }
    });
  }

  function onSaveLimits(event: FormEvent) {
    event.preventDefault();
    if (changedLimits.length === 0) return;
    const values: Partial<Record<LimitKey, string>> = {};
    for (const key of changedLimits) values[key] = limits[key].trim();

    startLimits(async () => {
      const res = await saveAiLimits({ values });
      if (res.ok) {
        success("Saved", res.message);
        setLimits((prev) => ({ ...prev, ...values }));
        setLimitsBaseline((prev) => ({ ...prev, ...values }));
      } else {
        error("Could not save", res.error);
      }
    });
  }

  const modelField = (key: ModelKey, label: string, help: string) => (
    <Field help={help}>
      <Label htmlFor={key}>{label}</Label>
      <Input
        id={key}
        name={key}
        value={models[key]}
        spellCheck={false}
        autoComplete="off"
        disabled={modelsPending}
        onChange={(e) => setModels((m) => ({ ...m, [key]: e.target.value }))}
      />
    </Field>
  );

  const limitField = (key: LimitKey, label: string, unit: string) => {
    const parsed = Number(limits[key]);
    const help =
      Number.isFinite(parsed) && parsed > 0
        ? `${fmtNumber(parsed)} ${unit}`
        : `Must be a positive whole number of ${unit}.`;
    return (
      <Field help={help}>
        <Label htmlFor={key}>{label}</Label>
        <Input
          id={key}
          name={key}
          type="number"
          min={1}
          step={1}
          inputMode="numeric"
          value={limits[key]}
          disabled={limitsPending}
          onChange={(e) => setLimits((l) => ({ ...l, [key]: e.target.value }))}
        />
      </Field>
    );
  };

  return (
    <div className="flex flex-col gap-6">
      {!activeConfigured ? (
        <div className="rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
          <span className="font-medium">The active provider has no API key. </span>
          Set <code className="font-mono">{PROVIDER_KEY_ENV[activeProvider]}</code> in the server
          environment. Until then the AI assistant, market reports and Library classification are
          paused and degrade gracefully (docs/11 §1).
        </div>
      ) : null}

      {/* -------------------------------------------------- active provider --- */}
      <Card>
        <CardHeader
          title="Active AI provider"
          description="Switching routes every AI request to a different third-party data processor — a governance event, confirmed and audited as ai.model_switch. Effective globally within 60 seconds."
          action={
            <Button variant="ghost" size="sm" onClick={recheckKeys} disabled={providerPending}>
              Recheck keys
            </Button>
          }
        />
        <CardBody className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            {PROVIDER_IDS.map((id) => (
              <div
                key={id}
                className={cn(
                  "rounded-lg border p-4",
                  id === activeProvider
                    ? "border-primary/60 bg-primary/5"
                    : "border-border bg-surface-2",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-foreground">
                    {PROVIDER_LABELS[id]}
                  </span>
                  {id === activeProvider ? <Badge variant="primary">Active</Badge> : null}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Badge variant={configured[id] ? "success" : "danger"} dot>
                    {configured[id] ? "API key configured" : "No API key"}
                  </Badge>
                  <span className="font-mono text-xs text-muted">{PROVIDER_KEY_ENV[id]}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <Field className="w-full sm:w-64">
              <Label htmlFor="active-provider">Route AI requests to</Label>
              <Select
                id="active-provider"
                value={selectedProvider}
                disabled={providerPending}
                onChange={(e) => setSelectedProvider(e.target.value as ProviderId)}
                options={PROVIDER_IDS.map((id) => ({
                  value: id,
                  label: configured[id]
                    ? PROVIDER_LABELS[id]
                    : `${PROVIDER_LABELS[id]} (no API key)`,
                }))}
              />
            </Field>
            <Button
              onClick={() => setConfirmOpen(true)}
              disabled={selectedProvider === activeProvider || providerPending}
            >
              Switch provider
            </Button>
          </div>
        </CardBody>
      </Card>

      {/* ---------------------------------------------------------- models --- */}
      <Card>
        <form onSubmit={onSaveModels}>
          <CardHeader
            title="Model IDs"
            description="Model identifiers per provider. A version bump is a settings change here, never a deploy (docs/11 §2.1). Model IDs are configuration, never hardcoded."
          />
          <CardBody className="flex flex-col gap-5">
            <div className="grid gap-4 sm:grid-cols-2">
              {modelField(
                "ai.chat_model.moonshot",
                "Chat model — Moonshot",
                "Kimi chat model, used when Moonshot is the active provider.",
              )}
              {modelField(
                "ai.chat_model.zhipu",
                "Chat model — Zhipu",
                "GLM chat model, used when Zhipu is the active provider.",
              )}
              {modelField(
                "ai.vision_model.moonshot",
                "Vision model — Moonshot",
                "Vision-capable model for Library image / scanned-PDF classification.",
              )}
              {modelField(
                "ai.vision_model.zhipu",
                "Vision model — Zhipu",
                "Vision-capable model for Library image / scanned-PDF classification.",
              )}
            </div>

            <div className="rounded-lg border border-border bg-surface-2 p-4">
              <div className="grid gap-4 sm:grid-cols-2">
                {modelField(
                  "ai.embedding.model",
                  "Embedding model",
                  "fn_semantic_search filters on this value. Changing it strands existing vectors — re-embed via runbook 5.10.",
                )}
                <div className="flex flex-col justify-center gap-2 text-xs text-muted">
                  <div className="flex items-center gap-2">
                    <span className="text-muted">Embedding provider</span>
                    <Badge variant="muted">{PROVIDER_LABELS[snapshot.embeddingProvider]}</Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-muted">Dimension</span>
                    <Badge variant="muted">{fmtNumber(snapshot.embeddingDim)}</Badge>
                  </div>
                  <p className="mt-1">
                    Provider and dimension are decoupled from the chat switch and change only via
                    migration + re-embed (docs/11 §6.2).
                  </p>
                </div>
              </div>
            </div>
          </CardBody>
          <CardFooter>
            {changedModels.length > 0 ? (
              <span className="mr-auto text-xs text-muted">
                {changedModels.length} unsaved change{changedModels.length > 1 ? "s" : ""}
              </span>
            ) : null}
            <Button type="submit" loading={modelsPending} disabled={changedModels.length === 0}>
              Save models
            </Button>
          </CardFooter>
        </form>
      </Card>

      {/* ---------------------------------------------------------- budgets --- */}
      <Card>
        <form onSubmit={onSaveLimits}>
          <CardHeader
            title="Budgets"
            description="The caps the gateway enforces against ai_usage before any provider call. Refusals are themselves metered, so abuse patterns stay visible (docs/11 §8)."
          />
          <CardBody>
            <div className="grid gap-4 sm:grid-cols-3">
              {limitField(
                "ai.limits.requests_per_user_per_hour",
                "Requests / user / hour",
                "requests per hour",
              )}
              {limitField(
                "ai.limits.tokens_per_user_per_day",
                "Tokens / user / day",
                "tokens per day",
              )}
              {limitField(
                "ai.limits.tokens_global_per_day",
                "Tokens / day (global)",
                "tokens per day",
              )}
            </div>
          </CardBody>
          <CardFooter>
            {changedLimits.length > 0 ? (
              <span className="mr-auto text-xs text-muted">
                {changedLimits.length} unsaved change{changedLimits.length > 1 ? "s" : ""}
              </span>
            ) : null}
            <Button type="submit" loading={limitsPending} disabled={changedLimits.length === 0}>
              Save budgets
            </Button>
          </CardFooter>
        </form>
      </Card>

      {/* ---------------------------------------------------- switch dialog --- */}
      <Dialog
        open={confirmOpen}
        onClose={() => {
          if (!providerPending) setConfirmOpen(false);
        }}
        dismissible={!providerPending}
        title="Switch active AI provider?"
        size="md"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => setConfirmOpen(false)}
              disabled={providerPending}
            >
              Cancel
            </Button>
            <Button variant="primary" onClick={confirmSwitch} loading={providerPending}>
              Switch provider
            </Button>
          </>
        }
      >
        <div className="text-sm text-foreground">
          <p>
            All AI requests will be routed to{" "}
            <strong className="text-foreground">{PROVIDER_LABELS[selectedProvider]}</strong> instead
            of {PROVIDER_LABELS[activeProvider]}. This changes the third-party data processor and is
            recorded in the audit log as <code className="font-mono">ai.model_switch</code>.
          </p>
          <p className="mt-2 text-muted">
            The switch is global and takes effect within 60 seconds. Stored embeddings are
            unaffected — the embedding provider is a separate setting.
          </p>
          {!configured[selectedProvider] ? (
            <p className="mt-3 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-danger">
              {PROVIDER_LABELS[selectedProvider]} has no API key (
              <span className="font-mono">{PROVIDER_KEY_ENV[selectedProvider]}</span>). After
              switching, the AI surfaces will be paused until the key is set.
            </p>
          ) : null}
        </div>
      </Dialog>
    </div>
  );
}
