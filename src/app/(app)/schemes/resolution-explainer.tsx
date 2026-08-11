import { Card, CardBody, CardHeader } from "@/components/ui/card";

/**
 * Static explainer for scheme resolution (docs/09 §4.1). For each earning row,
 * exactly one scheme resolves by walking scopes from most to least specific and
 * matching on the row's `period_end`. Rendered above the table so a reader
 * understands why a given scheme applies before scanning the list.
 */
export function ResolutionExplainer() {
  const steps = [
    {
      n: 1,
      title: "Account-specific",
      body: "A scheme for the earning's exact platform account, whose effective range contains the period's close date.",
    },
    {
      n: 2,
      title: "Model-specific",
      body: "Otherwise, a scheme for the earning's model, effective on the period's close date.",
    },
    {
      n: 3,
      title: "Studio default",
      body: "Otherwise, the default scheme — exactly one always exists, so resolution never fails.",
    },
  ];

  return (
    <Card>
      <CardHeader
        title="How a scheme is chosen"
        description="One scheme resolves per earning row, matched on the period's close date (period_end)."
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
        <p className="mt-4 text-xs text-muted">
          The most specific effective scheme wins:{" "}
          <span className="font-medium text-foreground">account → model → default</span>. A
          non-overlap exclusion per scope guarantees at most one candidate at each tier, so the
          split is always deterministic.
        </p>
      </CardBody>
    </Card>
  );
}
