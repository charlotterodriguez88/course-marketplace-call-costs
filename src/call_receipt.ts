export type CallReceipt = {
  requestId: string;
  costUsd: number;
  vendor: string;
};

type HeaderReader = {
  get(name: string): string | null;
};

export function readCallReceipt(
  headers: HeaderReader,
  requestId: string,
): CallReceipt {
  const rawCost = headers.get("x-infrai-cost-usd");
  const vendor = headers.get("x-infrai-vendor");

  if (rawCost === null || vendor === null) {
    throw new Error("The completion response did not include its call receipt headers.");
  }

  const costUsd = Number(rawCost);
  if (!Number.isFinite(costUsd) || costUsd < 0) {
    throw new Error("The completion response included an invalid call cost.");
  }

  return { requestId, costUsd, vendor };
}
