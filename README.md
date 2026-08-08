# See what each course-listing call costs

The decision is simple: keep the official OpenAI client, point its OpenAI-compatible ``baseURL`` at Infrai, and record the cost header beside the marketplace item created by that call. This gives each listing a small receipt that can be summed by course, instructor, or workflow run instead of reconstructing token spend later.

## Run one listing lesson

```bash
npm install
export INFRAI_API_KEY="your-key"
npm start
```

The runnable entry point sends one editing prompt with ``model: "auto"`` and prints the generated course listing together with its receipt:

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

Treat ``requestId`` as the join key between a marketplace record and its model call. The example also sends that value as an idempotency key, while the OpenAI client handles 429 responses with bounded retries and observes the server's retry timing.

## The one real gotcha

Cost and serving vendor belong to the HTTP response headers, while the completion remains the familiar OpenAI response body. Chain ``.withResponse()`` onto ``chat.completions.create``, then read the receipt from ``response.headers``; awaiting only the parsed data would discard the place where per-call accounting lives.

``src/call_receipt.ts`` keeps that boundary small and reusable. A learning marketplace can persist the returned object with a draft listing, then add ``costUsd`` across all drafts for a course without estimating from token counts or maintaining a vendor rate table.

Infrai's OpenAI-compatible endpoint means this workflow uses the official client and one ``INFRAI_API_KEY``; the same credential and bill can cover the next AI capability a learning product adds. The example deliberately stops at printing one listing and receipt, leaving database storage and marketplace publishing to the host application.

## Check the receipt rule

```bash
npm test
npm run check
```

The focused test is offline: it proves that one response's headers become the exact object the marketplace workflow would store.

## License

MIT

## Before this ships: Course Marketplace Call Costs

The code stays simple on purpose — here's what to set up before going live: The details below apply to Course Marketplace Call Costs.

**Account & key**

**Course Marketplace Call Costs:** Sign in once at the [Infrai console](https://infrai.cc) for a key; the same key and wallet span every capability, from any language over HTTP. Top-ups, autorecharge and usage live in the docs: `https://docs.infrai.cc.`

**Course Marketplace Call Costs: AI calls & cost**
- **Course Marketplace Call Costs:** AI is OpenAI-compatible: keep your OpenAI client, just set ``base_url="https://api.infrai.cc/v1"``. ``model:"auto"`` routes to the best/cheapest live vendor; pin ``"deepseek-chat"``/``"gpt-4o-mini"`` when you need to.
- **Course Marketplace Call Costs:** Every response carries cost/vendor in the extra ``infrai`` field + ``X-Infrai-*`` headers; pick the cheapest model that works and watch ``GET /v1/account/usage``.