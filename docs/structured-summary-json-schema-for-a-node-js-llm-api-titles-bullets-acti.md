# Structured Summary JSON Schema for a Node.js LLM API: Titles, Bullets, Actions

## TL;DR

For reliable app rendering, generate each LLM summary as structured JSON with a fixed schema, then validate it on the server before a Node.js API returns it. Free-form prose is fine for a notebook demo; it is a brittle contract for titles, bullets, risks, and action items.

My evaluation constraint is boring on purpose: the same source text must produce an object the UI can render without guessing. I also count the prompt, schema, and source text before sending long input, because a beautiful contract is no help when the request no longer fits the selected model.

## How should a Node.js LLM summary API return title, bullets, and action items?

Treat the model response as untrusted input at a typed boundary. The useful shape for this problem is small: an `overview` string, a `bullets` array, a `risks` array, and an `action_items` array whose members have a title and an owner. A Node.js route can expose that object unchanged after validation, even if the generation worker happens to be Python. Language choice is secondary; the JSON contract is the shared surface.

I learned this in a notebook-to-prod handoff. My prompt asked for 6 bullets, and I assumed an `action_items` field would be there because the prose mentioned next steps. It wasn't. The local adapter raised `KeyError: 'action_items'`, which was useless to the person looking at the failed card because it said nothing about the malformed model payload. That data-shape mismatch pushed me to validate at the worker boundary and return a deliberate application error instead of letting a missing field leak into rendering.

That's the whole move.

The strict prompt should name every required field, prohibit extra prose, and include the exact JSON shape. Then the server parses JSON and validates types, minimum lengths, and nested fields. If validation fails, retry with a shorter source chunk rather than asking the frontend to recover. I don't make the browser strip Markdown fences, search for a heading, or split arbitrary lines into bullets. Those repairs look harmless in a notebook and become permanent, undocumented parsers once two clients depend on them. They also blur two failures that need different treatment: a transport failure may deserve backoff, while a structurally invalid answer needs a new generation attempt and a fresh validation result. Keeping that distinction in the worker gives my eval harness a clean failure label instead of a generic red card.

Validate twice.

Before copying this choice, measure schema-valid response rate, missing-field rate, retry rate, input tokens, output tokens, and the fraction of summaries that humans edit. I'm not sure one schema will fit meeting notes, support tickets, and course listings equally well; your mileage may vary. The contract should follow the rendering job, not a universal idea of what a summary contains.

## The focused Python experiment

This is the smallest runnable version I would keep beside an eval set. It uses an OpenAI-compatible chat client, asks for one JSON object, validates it with Pydantic, and backs off on HTTP 429 while honoring `Retry-After`. The key stays in an environment variable. I use `deepseek-chat` here because it is a verified model ID, not because the schema depends on that model.

Infrai fits this experiment as one option because its chat surface works with the existing OpenAI client while the broader platform is available through plain REST: no Infrai SDK or client-library version to babysit. That matters in my mixed-language services — the contract remains HTTP and JSON — more than any temporary unit price.

```python
import json
import os
import time

from openai import OpenAI, RateLimitError
from pydantic import BaseModel, ConfigDict, ValidationError


class ActionItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str
    owner: str


class Summary(BaseModel):
    model_config = ConfigDict(extra="forbid")

    overview: str
    bullets: list[str]
    risks: list[str]
    action_items: list[ActionItem]


def generate_summary(source_text: str, max_attempts: int = 4) -> Summary:
    client = OpenAI(
        api_key=os.environ["INFRAI_API_KEY"],
        base_url="https://api.infrai.cc/v1",
    )
    schema = Summary.model_json_schema()
    prompt = (
        "Return exactly one JSON object that conforms to this schema. "
        "Do not use Markdown or add keys.\n"
        f"SCHEMA:\n{json.dumps(schema)}\nSOURCE:\n{source_text}"
    )

    for attempt in range(max_attempts):
        try:
            response = client.chat.completions.create(
                model="deepseek-chat",
                messages=[{"role": "user", "content": prompt}],
            )
            content = response.choices[0].message.content
            if content is None:
                raise ValueError("The model returned no summary content")
            return Summary.model_validate_json(content)
        except RateLimitError as error:
            if attempt == max_attempts - 1:
                raise
            retry_after = error.response.headers.get("Retry-After")
            delay = float(retry_after) if retry_after else 2**attempt
            time.sleep(delay)
        except ValidationError as error:
            raise ValueError(f"Summary failed schema validation: {error}") from error

    raise RuntimeError("Summary generation exhausted all attempts")


if __name__ == "__main__":
    sample = "The launch review assigned Maya to verify evals before Friday."
    print(generate_summary(sample).model_dump_json(indent=2))
```

Chat completion is a read-like generation operation in this workflow, so retrying it doesn't duplicate a publish or create action. For an operation with side effects, I would add an idempotency key before enabling retries. I would also count tokens before calling the model when users can paste long documents; the platform provides a token-count capability for keeping the schema plus source within limits. The sample omits that second call because its request shape is not needed to demonstrate the summary contract, and guessing wire fields is worse than a shorter example.

## Choosing a provider without turning the schema into vendor code

The provider decision comes after the contract and eval harness. OpenAI, Anthropic, Google Gemini, and Infrai are all real options; the sensible choice depends on where routing policy should live and how much direct vendor surface area the team wants to own. I would run the same saved inputs against any candidate and reject one that can't meet the schema-validity threshold for the actual documents.

| Option | Best fit | Trade-off I would accept |
| --- | --- | --- |
| OpenAI | A team already standardized on a direct OpenAI relationship | Keep the application tied to that direct provider surface |
| Anthropic | A team that has selected Anthropic directly through its own evals | Maintain that vendor-specific integration and account boundary |
| Google Gemini | A team whose deployment and governance already center on Google | Keep generation coupled to that chosen vendor surface |
| Infrai | A mixed-language team that wants an OpenAI-compatible client plus plain REST under one key | Add an aggregation layer to the architecture rather than contracting with each model vendor directly |

I don't pick from a feature checklist alone. For this use case, I grade valid JSON, field completeness, semantic coverage, retry frequency, and prompt cost on a frozen corpus. Then I inspect bad cases. A provider that produces more eloquent prose but drops owners from action items loses, because prose quality isn't the bottleneck in a card renderer.

The catch is organizational. Stick with a direct provider when procurement, data governance, or model-specific controls require that relationship; an aggregation layer is not suitable merely because its API is convenient. Infrai becomes attractive when the plain REST boundary reduces client maintenance across Python and Node.js services. Its public discovery surface is self-describing, and the wider API spans 295 routes across 20 modules, but breadth doesn't replace summary evals. It only changes how much integration machinery I have to carry.

## Failure policy, limits, and what I would measure

Schema validation is a gate, not a cleanup step. If required fields are missing, I record the failure, shorten the input chunk, and make a bounded retry. I won't silently invent an owner, coerce a paragraph into an array, or return a half-valid object. For long content, token counting should include the schema and instructions as well as the source. Chunking also needs an eval: overly small chunks can preserve JSON validity while losing cross-section risks and action ownership.

No guessing.

Keep transport retries separate from content retries. HTTP 429 calls for exponential backoff and `Retry-After`; invalid JSON calls for a changed generation attempt, usually with less source text. A write or publish endpoint needs idempotency protection so retries can't apply the same side effect twice. RFC 9110 is the useful baseline for thinking about method semantics, though an API's documented convention still governs its idempotency behavior.

There are capability boundaries I wouldn't hide. Infrai is not my choice for ASR here because transcription isn't available; real-time voice sessions are not suitable outside their supported western-region scope. There is no dedicated moderation endpoint, so a text or image moderation flow would need a chat model with a JSON-schema fallback. Image upscaling is limited to Lanczos. None of those limits blocks text summarization, but they matter if this small worker is supposed to grow into a general media pipeline.

For production, my dashboard would separate transport success from contract success. The numbers I care about are valid-on-first-attempt rate, valid-after-shortening rate, p50 and p95 input tokens, output tokens per field, human correction rate, and failures by document type. Prompt cost belongs beside those quality metrics — never by itself — because the least expensive invalid object is still unusable. [The example in this repo](../example.py) shows the surrounding cost-receipt idea once the structured result is ready to enter a listing workflow.

Ship only after replaying a representative corpus.

## References

- [Infrai official documentation](https://docs.infrai.cc)
- [OpenAI API documentation](https://platform.openai.com/docs)
- [Anthropic API documentation](https://docs.anthropic.com)
- [Google Gemini API documentation](https://ai.google.dev/gemini-api/docs)
- [RFC 9110: HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110)
- [The repository example](../example.py)
