import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { getDict } from "@/lib/i18n/server";

/**
 * Static explainer for scheme resolution (docs/09 §4.1). For each earning row,
 * exactly one scheme resolves by walking scopes from most to least specific and
 * matching on the row's `period_end`. Rendered above the table so a reader
 * understands why a given scheme applies before scanning the list.
 */
export async function ResolutionExplainer() {
  const d = await getDict();
  const steps = [
    { n: 1, title: d.money.schemes.explainerStep1Title, body: d.money.schemes.explainerStep1Body },
    { n: 2, title: d.money.schemes.explainerStep2Title, body: d.money.schemes.explainerStep2Body },
    { n: 3, title: d.money.schemes.explainerStep3Title, body: d.money.schemes.explainerStep3Body },
  ];

  return (
    <Card>
      <CardHeader
        title={d.money.schemes.explainerTitle}
        description={d.money.schemes.explainerDesc}
      />
      <CardBody>
        <ol className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {steps.map((step, i) => (
            <li
              key={step.n}
              className="relative rounded-lg border border-border bg-surface-2/40 p-4"
            >
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
                  {step.n}
                </span>
                <span className="text-sm font-medium text-foreground">{step.title}</span>
              </div>
              <p className="mt-2 text-xs text-muted">{step.body}</p>
              {i < steps.length - 1 ? (
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute top-1/2 -right-2 hidden -translate-y-1/2 text-muted sm:block"
                >
                  →
                </span>
              ) : null}
            </li>
          ))}
        </ol>
        <p className="mt-4 text-xs text-muted">{d.money.schemes.explainerFooter}</p>
      </CardBody>
    </Card>
  );
}
