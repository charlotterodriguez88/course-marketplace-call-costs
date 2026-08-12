# For SaaS, Do Accepted Results Make a Direct API or Unified Key Fallback Cheaper?

Short answer: the cheapest API for a SaaS feature is the option with the lowest cost per accepted task in that feature's eval set, after counting retries, fallback attempts, output length, and operational overhead. A public token rate is an input to that calculation, not the answer. Compare routed access and direct provider access with the same prompts, acceptance rules, and traffic classes before choosing either one.

This changes the buying question. OpenRouter, direct OpenAI access, and the Claude API represent two broad architectures: a routed interface with a unified key, or separate direct integrations. Neither architecture guarantees the lowest production cost. The result depends on which models pass the product's evals, how often the runtime retries, and whether work can move off the interactive path.

The data flow is straightforward. A request receives a stable task ID and prompt version, a policy selects an eligible model, every attempt records token usage and latency, an evaluator accepts or rejects the result, and only an accepted result can trigger the business action. Billing data then joins that trace. This is the bridge from notebook to production: the same acceptance test defines success in both places, while production adds concurrency, timeouts, and side-effect control.

## How should a Node.js SaaS app compare token cost and fallback?

Start with a representative task corpus, not a provider spreadsheet. Split it by behavior that matters: short classification, schema-bound extraction, retrieval-grounded answers, long-form generation, and tool-using agent runs should not share one blended average. Their input-to-output ratios differ, and an agent can add tool traces or retrieved context across attempts. Even with identical posted rates, those shapes can produce different winners.

For each task, define an executable acceptance rule before sending traffic. An extraction might require schema validation plus field-level correctness. A RAG response might require citation presence and a groundedness threshold. A support draft may need policy checks followed by human review. HTTP success only proves that a response arrived; it doesn't prove that the SaaS feature produced usable work.

**Cost per accepted task** is the primary measure:

`sum(cost of every attempt) / number of tasks that pass the acceptance rule`

Keep latency beside it rather than folding everything into a synthetic score. Interactive traffic needs tail-latency limits; asynchronous enrichment may tolerate a queue and batch execution. The OpenAI Batch API guide is one public example of a separate asynchronous path. It establishes that such a path exists, but it does not establish that every workload belongs there.

The comparison should preserve three layers that teams often mix together:

| Layer | Measure | Why it changes the decision |
| --- | --- | --- |
| Model behavior | Acceptance rate, input tokens, output tokens | A lower rate per token can lose when answers need more retries or run longer |
| Access architecture | Routing behavior, credential count, normalization | A unified key reduces application-side credential handling but adds a routing control plane |
| Workload operation | Tail latency, batch eligibility, engineering ownership | Direct calls, a managed router, and an internal gateway place work in different teams |

Don't average away rejected attempts. If candidate A passes 96 of 100 tasks on the first try and candidate B passes 82, the remaining attempts belong in B's cost record even if a fallback eventually rescues them. Those numbers are an illustration of the accounting method, not a benchmark or a claim about any model.

Rates change. So do models.

I'm not sure which access pattern will be cheapest for an unseen application, because the missing evidence is the application's prompt distribution, eval results, current account terms, and retry policy. Running the same versioned corpus through every eligible route resolves that uncertainty. A language choice does not: Node.js changes integration details, while the accounting model stays the same.

## Put a runnable acceptance ledger ahead of the network client

The first useful implementation is a local ledger. It should accept observed token counts and rates as inputs, preserve every attempt, and refuse to pretend that zero accepted tasks has a meaningful unit cost. All currency arithmetic below uses `Decimal`; floating-point rounding is a needless distraction in a billing check.

```python
from dataclasses import dataclass
from decimal import Decimal
from statistics import median


@dataclass(frozen=True)
class Attempt:
    task_id: str
    route: str
    prompt_version: str
    input_tokens: int
    output_tokens: int
    accepted: bool
    latency_ms: int


@dataclass(frozen=True)
class Rates:
    input_per_million: Decimal
    output_per_million: Decimal


def attempt_cost(attempt: Attempt, rates: Rates) -> Decimal:
    million = Decimal(1_000_000)
    return (
        Decimal(attempt.input_tokens) * rates.input_per_million
        + Decimal(attempt.output_tokens) * rates.output_per_million
    ) / million


def summarize(
    attempts: list[Attempt],
    rates_by_route: dict[str, Rates],
) -> dict[str, Decimal | int]:
    if not attempts:
        raise ValueError("at least one attempt is required")

    accepted_task_ids = {item.task_id for item in attempts if item.accepted}
    total_cost = sum(
        (attempt_cost(item, rates_by_route[item.route]) for item in attempts),
        start=Decimal("0"),
    )
    latencies = [item.latency_ms for item in attempts]

    return {
        "attempts": len(attempts),
        "accepted_tasks": len(accepted_task_ids),
        "total_cost": total_cost,
        "cost_per_accepted_task": (
            total_cost / len(accepted_task_ids)
            if accepted_task_ids
            else Decimal("Infinity")
        ),
        "median_attempt_latency_ms": int(median(latencies)),
    }


sample_attempts = [
    Attempt("case-101", "direct-a", "prompt-7", 840, 92, True, 710),
    Attempt("case-102", "direct-a", "prompt-7", 910, 130, False, 880),
    Attempt("case-102", "fallback-b", "prompt-7", 910, 105, True, 760),
]

verified_rates = {
    "direct-a": Rates(Decimal("0"), Decimal("0")),
    "fallback-b": Rates(Decimal("0"), Decimal("0")),
}

print(summarize(sample_attempts, verified_rates))
```

The zero rates are deliberate inputs, not advertised prices. Replace them at run time with current, verified rates for the exact model and account under test. Keeping prices out of source also forces the eval record to say when its commercial assumptions were captured. The sample contains three attempts for two accepted tasks, so the fallback is charged to the result it helped produce.

In a real harness, add a task-class field and aggregate by it. Also keep prompt version, route, model identifier, acceptance result, and the endpoint-reported usage record together. Estimators are useful before a call, but an estimate and a billed usage record are different observations; retain both instead of overwriting one with the other. Then replay the corpus whenever a prompt, model, tool definition, or routing rule changes.

This is where prompt-cost awareness becomes practical. Removing an irrelevant retrieved chunk can lower input usage, but it only counts as an improvement if groundedness and task acceptance hold. Shortening an answer cap can lower output usage, but it may break completeness. The eval catches both regressions. Cheap tokens attached to rejected work are still waste.

## Fallback is a state machine, not a second API call

A fallback policy needs explicit states and a total attempt budget. One workable sequence is `pending`, `attempted`, `accepted`, and `committed`. A candidate can move to `accepted` only after the evaluator passes it, and the business side effect can move to `committed` only once for the stable task ID. A second model call creates another attempt for the same task; it must not create a second order, ticket, or database mutation.

This distinction follows ordinary HTTP semantics. RFC 9110 defines idempotent methods and explains why a client can automatically retry an idempotent request after a communication failure. Model generation commonly sits behind a request that creates work, so the surrounding workflow cannot assume that replaying the entire operation is harmless. The application must supply its own operation identity and commit guard.

Be strict here.

A bounded policy might allow one primary attempt and one fallback only for named conditions. Eval rejection, local validation failure, provider throttling, and an ambiguous transport outcome are different events; record them separately. Local validation should happen before any paid call. An eval rejection may justify trying another eligible model. An ambiguous outcome requires checking the operation record before repeating a side effect. Collapsing all of these into a single `retry_count` field hides both the cost mechanism and the correctness risk.

The unified-key choice belongs at this layer, not in a UI toggle. A routed interface can centralize authentication and route selection. Direct integrations keep the request path shorter and expose provider-specific capabilities without a common-schema translation. An internal gateway can offer one application-facing contract while retaining direct upstream credentials, but then the team owns adapters, policy storage, observability, and on-call behavior.

There is a real catch in every direction. A managed router is not suitable when a provider-specific feature cannot be represented by its common request shape, or when another control-plane dependency conflicts with latency or compliance requirements. An internal gateway is a poor fit for a small team that cannot maintain normalization and incident response. Separate direct APIs become costly to operate when many services independently implement secret rotation, fallback, and usage accounting. Stick with the simplest pattern that satisfies the evaluated task set and the team's ownership capacity; change it only when measured constraints demand the move.

## Ship the policy with evidence, budgets, and observability

Once the notebook comparison produces eligible models, freeze a release policy by task class. Record the allowed routes, prompt version, acceptance threshold, maximum attempts, latency budget, and whether asynchronous processing is permitted. A routing rule that picks the lowest posted token rate without an eval constraint is cost roulette — it can exchange a visible invoice reduction for invisible rejected work.

Production telemetry should reconstruct one decision without requiring raw prompt storage. A useful record contains a trace ID, stable task ID, task class, prompt hash and version, selected route and model identifier, attempt reason, input and output usage, latency, eval outcome, and commit outcome. Apply the feature's privacy and retention rules to this data. Prompt bodies and retrieved documents can contain customer information, so cost observability is not permission to retain everything.

Before rollout, replay a representative corpus and force every allowed fallback branch. Verify that the maximum-attempt rule holds, the same task ID survives each attempt, and the commit guard permits one business action. Reconcile aggregate usage records with the ledger, then compare cost per accepted task and latency by task class. Roll out gradually; watch acceptance yield and spend together.

The operational check is intentionally plain. The eval corpus must resemble production traffic, current rates must be captured outside the code, each rejected attempt must remain visible, fallback must be bounded, and side effects must be idempotent at the business-operation level. The team also needs a named owner for credentials, adapters, routing policy, and billing reconciliation. If any one of those is missing, the architecture diagram is ahead of the system.

No universal winner follows from the words "direct" or "unified." The defensible choice is the one whose accepted-task yield, latency, failure behavior, and ownership cost fit the actual SaaS workload. Measure those together, and the cheapest option stops being a guess.

## Sources

- OpenAI Batch API guide: https://platform.openai.com/docs/guides/batch
- RFC 9110, HTTP Semantics: https://www.rfc-editor.org/rfc/rfc9110
