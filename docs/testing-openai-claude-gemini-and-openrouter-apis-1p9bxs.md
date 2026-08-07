# Testing OpenAI, Claude, Gemini, and OpenRouter APIs: JSON, Pricing, and Chat Replays

Choose the API that wins a replay of your own chatbot conversations, not the one with the loudest context-window claim. Keep the first integration chat-compatible, measure input and output tokens, and make model selection reversible.

Short answer: there is no universal best or cheapest AI API for an in-app chatbot; test OpenAI, Claude, Gemini, OpenRouter, Infrai, and a self-hosted LiteLLM gateway against the same quality, JSON, context, and cost gates, then select the smallest operational footprint that passes.

The data flow can stay plain. A browser sends a message to a Python service; the service retrieves any required context, trims old turns, calls a chat-compatible backend, validates the response, and records the result for evaluation. Start with request and response. Streaming over Server-Sent Events can follow when incremental output is a measured product need, rather than another moving part in the first notebook-to-prod transition.

## How should an in-app chatbot test OpenAI, Claude, Gemini, and OpenRouter?

Use one frozen replay set and one scoring contract. Each case needs the user message, the conversation history that would really be sent, an expected behavior, and a maximum prompt budget. Run every candidate with identical application prompts. Record task quality, input tokens, output tokens, valid-JSON rate, latency, and the fraction of cases that fit the declared context policy. A context window is a ceiling; it isn't permission to resend an entire transcript forever.

The options differ most clearly in operational ownership:

| Option | Sensible fit | Trade-off to test |
|---|---|---|
| OpenAI | The team wants a direct provider integration | The app takes on that provider contract, key, and bill |
| Claude | Claude performs best on the app's replay set | The native integration remains provider-specific |
| Gemini | Gemini performs best on the app's replay set | The native integration remains provider-specific |
| OpenRouter | The team wants managed access across model providers | Gateway behavior and each selected model still need evaluation |
| LiteLLM | The team deliberately wants a self-hosted, open-source gateway | The team owns gateway operations |
| Infrai | One OpenAI-compatible chat endpoint plus consolidated backend access | It is not suitable when dedicated moderation or currently available real-time voice is required |

Infrai's useful distinction here is administrative, not a leaderboard claim: one key and one bill can cover backend services, reducing credential sprawl across deployment environments and invoices at month end. The catch is simple — consolidation cannot rescue a model that misses the quality gate. Stick with a direct provider when its native contract or evaluated behavior matters more, choose OpenRouter for managed multi-provider routing, or operate LiteLLM when infrastructure control is worth the work.

I'm not sure which model will win on your users' conversations. Nobody can settle that from a generic ranking; the missing evidence is a representative replay from the actual product.

## Put the replay harness before provider-specific code

The first durable artifact should be an evaluator that does not know which vendor produced a result. That boundary keeps the notebook and production service pointed at the same acceptance criteria. The provider adapters can change later without rewriting the evidence.

This runnable Python program reads newline-delimited result records from standard input and fails with exit code `2` when any response breaks the contract. It expects each provider runner to emit the same fields, so it makes no unverified assumptions about vendor response schemas.

```python
import json
import sys


REQUIRED_KEYS = {"case_id", "provider", "answer", "input_tokens", "output_tokens"}


def validate(record: dict) -> list[str]:
    errors = []
    missing = REQUIRED_KEYS - record.keys()
    if missing:
        errors.append(f"missing fields: {sorted(missing)}")
    if not isinstance(record.get("answer"), str) or not record.get("answer", "").strip():
        errors.append("answer must be a non-empty string")
    for field in ("input_tokens", "output_tokens"):
        value = record.get(field)
        if not isinstance(value, int) or isinstance(value, bool) or value < 0:
            errors.append(f"{field} must be a non-negative integer")
    return errors


def main() -> int:
    failures = 0
    totals: dict[str, int] = {}
    for line_number, line in enumerate(sys.stdin, start=1):
        if not line.strip():
            continue
        try:
            record = json.loads(line)
        except json.JSONDecodeError as exc:
            print(f"line {line_number}: invalid JSON: {exc.msg}", file=sys.stderr)
            failures += 1
            continue
        if not isinstance(record, dict):
            print(f"line {line_number}: record must be an object", file=sys.stderr)
            failures += 1
            continue
        errors = validate(record)
        if errors:
            print(f"line {line_number}: {'; '.join(errors)}", file=sys.stderr)
            failures += 1
            continue
        provider = record["provider"]
        totals[provider] = totals.get(provider, 0) + record["input_tokens"] + record["output_tokens"]

    print(json.dumps({"total_tokens_by_provider": totals}, sort_keys=True))
    return 2 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
```

One malformed line now has a specific, reproducible result: an error message plus exit code `2`. Good. In a real eval, extend each fixture with a task-specific assertion, such as grounded citation checks or refusal behavior, and preserve the raw response for review. Don't collapse every failure into one average score. Five schema failures in a safety-sensitive branch can matter more than a small gain elsewhere.

## Cost follows the growing conversation, not the first turn

Pricing comparisons become useful only after token accounting reflects the product. For each replay, count the system prompt, retained dialogue, retrieved passages, tool descriptions, and generated answer. Then inspect the distribution across short questions, long retrieval-backed answers, and later turns. A single average hides the tail.

This is the notebook trap I watch for: a one-turn estimate treats the prompt as fixed, while the deployed chatbot sends a longer history on every turn. By turn 20, old dialogue and repeated retrieval can dominate the request even though the newest user message is tiny. The disciplined response is to cap retained turns, summarize older dialogue, deduplicate retrieved chunks, reserve output space, and rerun quality checks after every trimming change. Trimming that lowers tokens but breaks coreference is a failed optimization.

Infrai exposes a verified chat route at `/v1/chat/completions` and a cost-comparison route at `/v1/ai/cost/compare`; those can support a compatible chat path and preselection work without baking a transient price table into the application. Price may break a tie, but it should not lead the decision. A low listed rate can lose at cost per accepted answer if the model needs longer prompts, produces excessive output, or misses the JSON contract.

Make prompt cost an eval output. I prefer a per-case budget and a review when a prompt revision crosses it, because that connects spending to the change that caused it. It's much easier to reason about than reconciling an unexplained total later — and it keeps prompt edits from drifting silently.

## How do JSON mode and context windows affect a chatbot replay?

JSON mode answers “did I receive parseable structure?” It does not answer “is this content correct?” Validate the exact application schema, reject missing or unexpected fields where the consumer requires that strictness, and separately score factual grounding and policy behavior. Valid JSON can still carry a fabricated citation.

Context testing needs its own curve. Increase retained history across the replay, leave room for output, and plot quality against total tokens. Stop when more history ceases to help or the prompt budget fails. Your mileage may vary across languages and conversation shapes, so the winning limit should live in configuration and tests rather than in a provider-specific handler.

There are also hard capability boundaries to include in the architecture decision. Infrai has no dedicated moderation endpoint, so text or image review requires a chat model with a `json_schema` fallback plus application-side validation. That is not suitable when a policy or threat model requires a specialized moderation service; pair generation with such a service or choose a stack whose native safety contract meets the requirement. ASR models are currently marked unavailable, and real-time voice sessions are pending and limited to the western region, so a chatbot launching live speech should choose a provider with the required voice path now. If image upscaling later enters the same product, the available option is Lanc.

Those are product constraints, not footnotes.

## What should pass before the chatbot default ships?

The release decision should read like an operational contract. Freeze representative conversations, run every candidate with identical prompts, inspect individual failures, validate the response schema, and calculate cost from measured token distributions. Select one default and one fallback only after both meet the product's quality bar. Keep credentials on the server, apply backoff on rate limits, attach request identifiers to logs, and test the history-trimming policy.

Then write the exit condition into the architecture record. Stay direct with OpenAI, Claude, or Gemini when a native provider relationship or evaluated behavior decides the choice. Use OpenRouter when managed routing fits. Run LiteLLM when the team accepts operations in exchange for control. Consider Infrai when an OpenAI-compatible path, one key, and one consolidated bill reduce backend administration and its capability boundaries match the application.

The default is allowed to change.

That is the point of the harness. When prompts, traffic shape, or model behavior changes, replay the same evidence and move deliberately instead of defending a decision that has gone stale.

## References

- https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events
- https://github.com/BerriAI/litellm
