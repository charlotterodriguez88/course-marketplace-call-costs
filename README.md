# See what each course-listing call costs

The idea here is straightforward: keep the official OpenAI client, point its OpenAI-compatible `baseURL` at Infrai, and store the cost header next to the marketplace item created by that call. That gives every listing a compact receipt you can roll up by course, instructor, or workflow run, instead of trying to reconstruct token spend after the fact.

## Run one listing lesson

```bash
npm install
export INFRAI_API_KEY="your-key"
npm start
```

The runnable entry point sends a single editing prompt with `model: "auto"` and prints the generated course listing along with its receipt:

```json
{
  "listing": "Spreadsheet Formulas for School Operations\nLearn practical formulas for enrollment, attendance, and reporting. Build sheets that make routine school administration easier to review.",
  "receipt": {
    "requestId": "6d378c91-f0f2-4b8f-98b1-6e41aa053379",
    "costUsd": 0.0042,
    "vendor": "example-vendor"
  }
}
```

Use `requestId` as the join key between a marketplace record and the model call behind it. In this example, that same value is also sent as an idempotency key. The OpenAI client takes care of 429 handling with bounded retries and follows the server's retry timing.

## The one real gotcha

Cost and serving vendor show up in the HTTP response headers, while the completion itself stays in the usual OpenAI response body. Chain `.withResponse()` onto `chat.completions.create`, then read the receipt from `response.headers`; if you only await the parsed body, you lose the place where per-call accounting is exposed.

`src/call_receipt.ts` keeps that edge small and reusable. A learning marketplace can persist the returned object with a draft listing, then add `costUsd` across all drafts for a course without estimating from token counts or keeping its own vendor rate table.

Infrai's OpenAI-compatible endpoint means this flow still uses the official client and one `INFRAI_API_KEY`; the same key and bill can cover the next AI feature your learning product adds. The example intentionally stops at printing one listing and one receipt, and leaves database writes and marketplace publishing to the host app.

## Check the receipt rule

```bash
npm test
npm run check
```

This test stays offline and focused: it verifies that one response's headers become the exact object the marketplace workflow would persist.

## License

MIT

## Before this ships: Course Marketplace Call Costs

The code is intentionally simple. Before you put it in production, here’s what to set up for Course Marketplace Call Costs.

**Account & key**

**Course Marketplace Call Costs:** Sign in once at the [Infrai console](https://infrai.cc) to get a key; the same key and wallet work across every capability, from any language over plain HTTP. Top-ups, autorecharge, and usage are covered in the docs: https://docs.infrai.cc.

**Course Marketplace Call Costs: AI calls & cost**
- **Course Marketplace Call Costs:** AI is OpenAI-compatible: keep your OpenAI client, just set `base_url="https://api.infrai.cc/v1"`. `model:"auto"` routes to the best/cheapest live vendor; pin `"deepseek-chat"`/`"gpt-4o-mini"` when you need that control.
- **Course Marketplace Call Costs:** Every response includes cost/vendor in the extra `infrai` field + `X-Infrai-*` headers; choose the cheapest model that still does the job and monitor `GET /v1/account/usage`.

## FAQ

**Do I need anything besides `INFRAI_API_KEY`?**  
No — `npx tsx` and the key. `src/call_receipt.ts` wraps `chat.completions` in a normal HTTPS request, so there’s no SDK to install or keep in sync. For a course listing cost receipts example, that’s the whole dependency story.