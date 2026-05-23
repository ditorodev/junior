import { Agent as CursorAgent } from "@cursor/sdk";
import type { SDKAgent, SDKMessage } from "@cursor/sdk";
import {
  type Api,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Context,
  type Message,
  type Model,
  type SimpleStreamOptions,
  type StopReason,
  type TextContent,
  type ThinkingContent,
  type UserMessage,
  type Usage,
  createAssistantMessageEventStream,
} from "@mariozechner/pi-ai";

export interface CursorStreamOptions {
  /** Cursor API key. Falls back to `process.env.CURSOR_API_KEY`. */
  apiKey?: string;
  /**
   * Working directory passed to `Agent.create({ local: { cwd } })`. Cursor
   * runs filesystem/tool ops inside this directory. Falls back to
   * `process.cwd()`.
   */
  cwd?: string;
}

const CURSOR_MODEL_PREFIX = "cursor/";

const ZERO_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

/**
 * Build a pi-ai compatible `streamSimple` function that delegates each
 * model call to a fresh Cursor local agent run via `@cursor/sdk`. Cursor's
 * multi-step output (tool calls, thinking, text) is normalized into pi-ai
 * `AssistantMessageEvent`s so pi-agent-core sees a single assistant turn.
 *
 * Junior's tools are not exposed to Cursor — Cursor uses its own native
 * tools (filesystem, shell) inside the configured `cwd`. The collapsed text
 * is what flows back into pi-agent-core's loop.
 */
export function createCursorStreamFn(options: CursorStreamOptions = {}) {
  const cwd = options.cwd ?? process.cwd();
  return function cursorStream(
    model: Model<Api>,
    context: Context,
    streamOptions?: SimpleStreamOptions,
  ): AssistantMessageEventStream {
    const apiKey =
      options.apiKey ?? streamOptions?.apiKey ?? process.env.CURSOR_API_KEY;
    return runCursorStream({ apiKey, cwd, model, context, streamOptions });
  };
}

interface CursorRunInputs {
  apiKey: string | undefined;
  cwd: string;
  model: Model<Api>;
  context: Context;
  streamOptions: SimpleStreamOptions | undefined;
}

function runCursorStream(inputs: CursorRunInputs): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  void drive(stream, inputs);
  return stream;
}

async function drive(
  stream: AssistantMessageEventStream,
  inputs: CursorRunInputs,
): Promise<void> {
  const partial = makeInitialMessage(inputs.model);
  let agent: SDKAgent | undefined;
  let abortListener: (() => void) | undefined;

  try {
    stream.push({ type: "start", partial });
    const signal = inputs.streamOptions?.signal;
    throwIfAborted(signal);

    if (!inputs.apiKey) {
      throw new Error(
        "Cursor API key missing — set CURSOR_API_KEY or pass apiKey to createCursorStreamFn.",
      );
    }

    agent = await CursorAgent.create({
      apiKey: inputs.apiKey,
      model: { id: stripCursorPrefix(inputs.model.id) },
      local: { cwd: inputs.cwd },
    });

    const prompt = buildCursorPrompt(inputs.context);
    const run = await agent.send(prompt);
    if (signal && abortListener === undefined) {
      abortListener = () => {
        void run.cancel().catch(() => undefined);
      };
      signal.addEventListener("abort", abortListener, { once: true });
    }

    const sink = createTurnSink(stream, partial);
    for await (const message of run.stream()) {
      throwIfAborted(signal);
      handleCursorMessage(message, sink);
    }
    sink.finalize();
    partial.stopReason = "stop";
    stream.push({ type: "done", reason: "stop", message: partial });
    stream.end();
  } catch (error) {
    const reason: Extract<StopReason, "aborted" | "error"> = isAbortError(
      error,
      inputs.streamOptions?.signal,
    )
      ? "aborted"
      : "error";
    partial.stopReason = reason;
    partial.errorMessage = describeError(error);
    stream.push({ type: "error", reason, error: partial });
    stream.end();
  } finally {
    if (abortListener && inputs.streamOptions?.signal) {
      inputs.streamOptions.signal.removeEventListener("abort", abortListener);
    }
    if (agent) {
      try {
        await agent.close?.();
      } catch {
        // close is best-effort — failure must not mask the run result.
      }
    }
  }
}

interface TurnSink {
  appendText(text: string): void;
  appendThinking(text: string): void;
  finalize(): void;
}

function createTurnSink(
  stream: AssistantMessageEventStream,
  partial: AssistantMessage,
): TurnSink {
  let textIndex = -1;
  let thinkingIndex = -1;

  return {
    appendText(text: string) {
      if (!text) return;
      if (textIndex < 0) {
        textIndex = partial.content.length;
        partial.content.push({ type: "text", text: "" } as TextContent);
        stream.push({
          type: "text_start",
          contentIndex: textIndex,
          partial,
        });
      }
      const block = partial.content[textIndex];
      if (!block || block.type !== "text") return;
      block.text += text;
      stream.push({
        type: "text_delta",
        contentIndex: textIndex,
        delta: text,
        partial,
      });
    },
    appendThinking(text: string) {
      if (!text) return;
      if (thinkingIndex < 0) {
        thinkingIndex = partial.content.length;
        partial.content.push({
          type: "thinking",
          thinking: "",
        } as ThinkingContent);
        stream.push({
          type: "thinking_start",
          contentIndex: thinkingIndex,
          partial,
        });
      }
      const block = partial.content[thinkingIndex];
      if (!block || block.type !== "thinking") return;
      block.thinking += text;
      stream.push({
        type: "thinking_delta",
        contentIndex: thinkingIndex,
        delta: text,
        partial,
      });
    },
    finalize() {
      if (thinkingIndex >= 0) {
        const block = partial.content[thinkingIndex];
        if (block && block.type === "thinking") {
          stream.push({
            type: "thinking_end",
            contentIndex: thinkingIndex,
            content: block.thinking,
            partial,
          });
        }
      }
      if (textIndex >= 0) {
        const block = partial.content[textIndex];
        if (block && block.type === "text") {
          stream.push({
            type: "text_end",
            contentIndex: textIndex,
            content: block.text,
            partial,
          });
        }
      }
    },
  };
}

function handleCursorMessage(message: SDKMessage, sink: TurnSink): void {
  if (message.type === "assistant") {
    for (const block of message.message.content) {
      if (block.type === "text" && typeof block.text === "string") {
        sink.appendText(block.text);
      }
    }
    return;
  }
  if (message.type === "thinking" && typeof message.text === "string") {
    sink.appendThinking(message.text);
  }
}

function buildCursorPrompt(context: Context): string {
  const parts: string[] = [];
  if (context.systemPrompt) {
    parts.push(`# System\n${context.systemPrompt}`);
  }
  for (const message of context.messages) {
    const rendered = renderMessage(message);
    if (rendered) parts.push(rendered);
  }
  return parts.join("\n\n");
}

function renderMessage(message: Message): string | undefined {
  if (message.role === "user") return renderUser(message);
  if (message.role === "assistant") return renderAssistant(message);
  return renderToolResult(message);
}

function renderUser(message: UserMessage): string | undefined {
  const text = extractText(message.content);
  return text ? `# User\n${text}` : undefined;
}

function renderAssistant(message: AssistantMessage): string | undefined {
  const texts: string[] = [];
  for (const part of message.content) {
    if (part.type === "text") texts.push(part.text);
  }
  const text = texts.join("");
  return text ? `# Assistant\n${text}` : undefined;
}

function renderToolResult(message: {
  role: "toolResult";
  toolName: string;
  content: Array<TextContent | { type: "image" }>;
}): string | undefined {
  const text = extractText(message.content);
  if (!text) return undefined;
  return `# Tool Result (${message.toolName})\n${text}`;
}

function extractText(
  content: string | Array<TextContent | { type: string; text?: string }>,
): string {
  if (typeof content === "string") return content;
  const out: string[] = [];
  for (const part of content) {
    if (part && part.type === "text") {
      const text = (part as TextContent).text;
      if (typeof text === "string") out.push(text);
    }
  }
  return out.join("");
}

function makeInitialMessage(model: Model<Api>): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: { ...ZERO_USAGE, cost: { ...ZERO_USAGE.cost } },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new DOMException("Cursor stream aborted", "AbortError");
  }
}

function isAbortError(
  error: unknown,
  signal: AbortSignal | undefined,
): boolean {
  if (signal?.aborted) return true;
  if (error instanceof Error && error.name === "AbortError") return true;
  return false;
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown cursor stream error";
  }
}

function stripCursorPrefix(modelId: string): string {
  return modelId.startsWith(CURSOR_MODEL_PREFIX)
    ? modelId.slice(CURSOR_MODEL_PREFIX.length)
    : modelId;
}

let envStreamFn: ReturnType<typeof createCursorStreamFn> | undefined;

function getEnvStreamFn(): ReturnType<typeof createCursorStreamFn> {
  if (!envStreamFn) {
    envStreamFn = createCursorStreamFn({
      apiKey: process.env.CURSOR_API_KEY,
      cwd: process.env.CURSOR_CWD ?? process.cwd(),
    });
  }
  return envStreamFn;
}

/**
 * Pi-ai provider entry point — used internally by `registerCursorProvider`.
 * Resolves `CURSOR_API_KEY` and `CURSOR_CWD` lazily on first call so
 * importing this module is side-effect safe even when cursor credentials
 * are absent.
 */
export function stream(
  model: Model<Api>,
  context: Context,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream {
  return getEnvStreamFn()(model, context, options);
}

/** Pi-ai "simple" stream entry point — same adapter as `stream`. */
export const streamSimple = stream;
