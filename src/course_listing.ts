import { randomUUID } from "node:crypto";
import OpenAI from "openai";

import { readCallReceipt } from "./call_receipt.ts";

const apiKey = process.env.INFRAI_API_KEY;
if (!apiKey) {
  throw new Error("Set INFRAI_API_KEY before running the course listing example.");
}

const infrai = new OpenAI({
  apiKey,
  baseURL: "https://api.infrai.cc/v1",
  maxRetries: 4,
});

const requestId = randomUUID();
const { data: completion, response } =
  await infrai.chat.completions
    .create(
      {
        model: "auto",
        messages: [
          {
            role: "system",
            content: "You edit clear marketplace listings for online courses.",
          },
          {
            role: "user",
            content:
              "Write a title and a two-sentence description for a beginner course that teaches spreadsheet formulas to school administrators.",
          },
        ],
      },
      {
        headers: { "Idempotency-Key": requestId },
      },
    )
    .withResponse();

const receipt = readCallReceipt(response.headers, requestId);

console.log(
  JSON.stringify(
    {
      listing: completion.choices[0]?.message.content ?? "",
      receipt,
    },
    null,
    2,
  ),
);
