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
import { useDict, useLocale } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/format";
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
  const dict = useDict();
  const d = dict.adminAi.settings;
  const fm = fmt(useLocale());
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
        success(d.toastSwitched, res.message);
        setActiveProvider(selectedProvider);
        setConfirmOpen(false);
      } else {
        error(d.toastSwitchFailed, res.error);
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
        success(d.toastKeysRefreshed);
      } else {
        error(d.toastRefreshFailed, res.error);
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
        success(d.toastSaved, res.message);
        setModels((prev) => ({ ...prev, ...values }));
        setModelsBaseline((prev) => ({ ...prev, ...values }));
      } else {
        error(d.toastSaveFailed, res.error);
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
        success(d.toastSaved, res.message);
        setLimits((prev) => ({ ...prev, ...values }));
        setLimitsBaseline((prev) => ({ ...prev, ...values }));
      } else {
        error(d.toastSaveFailed, res.error);
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
        ? d.limitHelp(fm.number(parsed), unit)
        : d.limitHelpInvalid(unit);
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
          <span className="font-medium">{d.noKeyBanner} </span>
          {d.noKeyBannerBody(PROVIDER_KEY_ENV[activeProvider])}
        </div>
      ) : null}

      {/* -------------------------------------------------- active provider --- */}
      <Card>
        <CardHeader
          title={d.providerCardTitle}
          description={d.providerCardDescription}
          action={
            <Button variant="ghost" size="sm" onClick={recheckKeys} disabled={providerPending}>
              {d.recheckKeys}
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
                  {id === activeProvider ? (
                    <Badge variant="primary">{d.activeBadge}</Badge>
                  ) : null}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Badge variant={configured[id] ? "success" : "danger"} dot>
                    {configured[id] ? d.keyConfigured : d.keyMissing}
                  </Badge>
                  <span className="font-mono text-xs text-muted">{PROVIDER_KEY_ENV[id]}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <Field className="w-full sm:w-64">
              <Label htmlFor="active-provider">{d.routeTo}</Label>
              <Select
                id="active-provider"
                value={selectedProvider}
                disabled={providerPending}
                onChange={(e) => setSelectedProvider(e.target.value as ProviderId)}
                options={PROVIDER_IDS.map((id) => ({
                  value: id,
                  label: configured[id]
                    ? PROVIDER_LABELS[id]
                    : d.optionNoKey(PROVIDER_LABELS[id]),
                }))}
              />
            </Field>
            <Button
              onClick={() => setConfirmOpen(true)}
              disabled={selectedProvider === activeProvider || providerPending}
            >
              {d.switchCta}
            </Button>
          </div>
        </CardBody>
      </Card>

      {/* ---------------------------------------------------------- models --- */}
      <Card>
        <form onSubmit={onSaveModels}>
          <CardHeader
            title={d.modelsTitle}
            description={d.modelsDescription}
          />
          <CardBody className="flex flex-col gap-5">
            <div className="grid gap-4 sm:grid-cols-2">
              {modelField(
                "ai.chat_model.moonshot",
                d.chatModelMoonshot,
                d.chatModelMoonshotHelp,
              )}
              {modelField("ai.chat_model.zhipu", d.chatModelZhipu, d.chatModelZhipuHelp)}
              {modelField(
                "ai.vision_model.moonshot",
                d.visionModelMoonshot,
                d.visionModelHelp,
              )}
              {modelField("ai.vision_model.zhipu", d.visionModelZhipu, d.visionModelHelp)}
            </div>

            <div className="rounded-lg border border-border bg-surface-2 p-4">
              <div className="grid gap-4 sm:grid-cols-2">
                {modelField(
                  "ai.embedding.model",
                  d.embeddingModelLabel,
                  d.embeddingModelHelp,
                )}
                <div className="flex flex-col justify-center gap-2 text-xs text-muted">
                  <div className="flex items-center gap-2">
                    <span className="text-muted">{d.embeddingProviderLabel}</span>
                    <Badge variant="muted">{PROVIDER_LABELS[snapshot.embeddingProvider]}</Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-muted">{d.dimensionLabel}</span>
                    <Badge variant="muted">{fm.number(snapshot.embeddingDim)}</Badge>
                  </div>
                  <p className="mt-1">{d.embeddingNote}</p>
                </div>
              </div>
            </div>
          </CardBody>
          <CardFooter>
            {changedModels.length > 0 ? (
              <span className="mr-auto text-xs text-muted">
                {d.unsavedChanges(changedModels.length)}
              </span>
            ) : null}
            <Button type="submit" loading={modelsPending} disabled={changedModels.length === 0}>
              {d.saveModels}
            </Button>
          </CardFooter>
        </form>
      </Card>

      {/* ---------------------------------------------------------- budgets --- */}
      <Card>
        <form onSubmit={onSaveLimits}>
          <CardHeader
            title={d.budgetsTitle}
            description={d.budgetsDescription}
          />
          <CardBody>
            <div className="grid gap-4 sm:grid-cols-3">
              {limitField(
                "ai.limits.requests_per_user_per_hour",
                d.limitRequestsLabel,
                d.limitRequestsUnit,
              )}
              {limitField(
                "ai.limits.tokens_per_user_per_day",
                d.limitTokensUserLabel,
                d.limitTokensUnit,
              )}
              {limitField(
                "ai.limits.tokens_global_per_day",
                d.limitTokensGlobalLabel,
                d.limitTokensUnit,
              )}
            </div>
          </CardBody>
          <CardFooter>
            {changedLimits.length > 0 ? (
              <span className="mr-auto text-xs text-muted">
                {d.unsavedChanges(changedLimits.length)}
              </span>
            ) : null}
            <Button type="submit" loading={limitsPending} disabled={changedLimits.length === 0}>
              {d.saveBudgets}
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
        title={d.switchDialogTitle}
        size="md"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => setConfirmOpen(false)}
              disabled={providerPending}
            >
              {dict.common.cancel}
            </Button>
            <Button variant="primary" onClick={confirmSwitch} loading={providerPending}>
              {d.switchCta}
            </Button>
          </>
        }
      >
        <div className="text-sm text-foreground">
          {/* Both provider names are arguments to one translated sentence: in
              Russian they take different cases and a different order, which no
              amount of splitting into <strong> fragments could express. */}
          <p>
            {d.switchDialogBody(
              PROVIDER_LABELS[selectedProvider],
              PROVIDER_LABELS[activeProvider],
            )}
          </p>
          <p className="mt-2 text-muted">{d.switchDialogNote}</p>
          {!configured[selectedProvider] ? (
            <p className="mt-3 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-danger">
              {d.switchDialogNoKey(
                PROVIDER_LABELS[selectedProvider],
                PROVIDER_KEY_ENV[selectedProvider],
              )}
            </p>
          ) : null}
        </div>
      </Dialog>
    </div>
  );
}
