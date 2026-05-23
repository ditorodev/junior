import { registerApiProvider } from "@mariozechner/pi-ai";
import type { Model } from "@mariozechner/pi-ai";

import { stream, streamSimple } from "./stream.js";

/**
 * Pi-ai api id we register for cursor-backed models. Pi-ai dispatches stream
 * calls to the registered provider whose `api` field matches the model's
 * `api`.
 */
export const CURSOR_API_ID = "cursor-composer" as const;

const CURSOR_MODEL_PREFIX = "cursor/";

const ZERO_COST = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
} as const;

function cursorModel(id: string, name: string): Model<typeof CURSOR_API_ID> {
  return {
    id,
    name,
    api: CURSOR_API_ID,
    provider: "cursor",
    baseUrl: "https://api.cursor.com",
    reasoning: true,
    input: ["text"],
    cost: ZERO_COST,
    contextWindow: 200_000,
    maxTokens: 16_000,
  } as Model<typeof CURSOR_API_ID>;
}

/**
 * Cursor model entries exposed through pi-ai. Each entry is registered with
 * `api: CURSOR_API_ID` so pi-ai dispatches to the cursor stream provider
 * when junior selects one of these model ids.
 *
 * Pricing is left at zero — usage isn't reported through pi-ai for cursor
 * runs. Deployments that need precise accounting should wrap these.
 */
export const CURSOR_MODELS: Model<typeof CURSOR_API_ID>[] = [
  cursorModel("cursor/composer-2", "Cursor Composer 2"),
  cursorModel("cursor/composer-2.5", "Cursor Composer 2.5"),
];

/** True for any model id under the `cursor/` namespace. */
export function isCursorModelId(id: string): boolean {
  return id.startsWith(CURSOR_MODEL_PREFIX);
}

/**
 * Look up a cursor model by id. Returns `undefined` when the id is not a
 * known cursor model — callers that want fail-fast behavior should throw at
 * their config boundary.
 */
export function resolveCursorModel(
  modelId: string,
): Model<typeof CURSOR_API_ID> | undefined {
  return CURSOR_MODELS.find((m) => m.id === modelId);
}

let registered = false;

/**
 * Register the cursor api provider with pi-ai. Idempotent — safe to call
 * from multiple module-load sites. Junior calls this once at startup so
 * cursor model ids dispatch through `streamSimple` to `@cursor/sdk`.
 */
export function registerCursorProvider(): void {
  if (registered) return;
  registerApiProvider({
    api: CURSOR_API_ID,
    stream,
    streamSimple,
  });
  registered = true;
}
