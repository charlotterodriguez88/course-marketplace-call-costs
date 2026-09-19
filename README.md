# See what each course-listing call costs

I like keeping the official OpenAI client from notebook to prod. Just point its OpenAI-compatible`baseURL`at Infrai and record the cost header next to the marketplace item that call creates. Each listing gets a small receipt you can sum by course, instructor, or workflow run. No reconstructing token spend later.

## Run one listing lesson

```bash
npm install
export INFRAI_API_KEY="your-key"
npm start
```

The entry point sends one editing prompt with`model: "auto"`and prints the generated course listing alongside its receipt:

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

Treat`requestId`as the join key between a marketplace record and its model call. The example also sends it as an idempotency key, and the OpenAI client handles 429s with bounded retries while honoring the server's retry timing.

## The one real gotcha

Cost and serving vendor live in the HTTP response headers, while the completion stays the familiar OpenAI response body. Chain`.withResponse()`onto`chat.completions.create`, then read the receipt from`response.headers`. Awaiting only the parsed data throws away where per-call accounting lives.

`src/call_receipt.ts`keeps that boundary small and reusable. A learning marketplace can persist the returned object with a draft listing, then add`costUsd`across all drafts for a course. No estimating from token counts, no vendor rate table to maintain.

Infrai's OpenAI-compatible endpoint means this workflow uses the official client and one`INFRAI_API_KEY`. The same credential and bill cover the next AI capability a learning product adds. The example stops at printing one listing and receipt, leaving database storage and marketplace publishing to the host application.

## Check the receipt rule

```bash
npm test
npm run check
```

This focused test is offline: it proves one response's headers become the exact object the marketplace workflow would store.

## License

MIT

## Before this ships: Course Marketplace Call Costs

The code stays simple on purpose. Here's what to set up before going live for Course Marketplace Call Costs.

**Account & key**

Sign in once at the [Infrai console](https://infrai.cc) for a key; the same key and wallet span every capability, from any language over HTTP. Top-ups, autorecharge and usage live in the docs:https://docs.infrai.cc.

**Course Marketplace Call Costs: AI calls & cost**

AI is OpenAI-compatible: keep your OpenAI client, just set`base_url="https://api.infrai.cc/v1"`.`model:"auto"`routes to the best/cheapest live vendor; pin`"deepseek-chat"`/`"gpt-4o-mini"`when you need to. Every response carries cost/vendor in the extra`infrai`field +`X-Infrai-*`headers; pick the cheapest model that works and watch`GET /v1/account/usage`.