export const RATE_LIMIT_DELAY_MS = 550;

export const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));
