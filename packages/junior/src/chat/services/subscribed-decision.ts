import { z } from "zod";

export enum SubscribedReplyReason {
  ThreadOptOut = "thread_opt_out",
  ExplicitMention = "explicit_mention",
  DirectedFollowUp = "directed_follow_up",
  DirectedToOtherParty = "directed_to_other_party",
  EmptyMessage = "empty_message",
  Classifier = "llm_classifier",
  SideConversation = "side_conversation",
  LowConfidence = "low_confidence",
  ClassifierError = "classifier_error",
  SubscribedDefault = "subscribed_default",
}

export interface SubscribedDecisionInput {
  rawText: string;
  text: string;
  conversationContext?: string;
  hasAttachments?: boolean;
  isExplicitMention?: boolean;
  context: {
    threadId?: string;
    requesterId?: string;
    channelId?: string;
    runId?: string;
  };
}

export interface SubscribedDecisionResult {
  shouldReply: boolean;
  shouldUnsubscribe?: boolean;
  reason: SubscribedReplyReason;
  reasonDetail?: string;
}

interface TranscriptMessage {
  author: string;
  role: "assistant" | "system" | "user";
  text: string;
}

interface RouterSignals {
  assistantWasLastSpeaker: boolean;
  currentMessageHasDirectedFollowUpCue: boolean;
  currentMessageHasAttachments: boolean;
  currentMessageIsTerseClarification: boolean;
  humanMessagesSinceLastAssistant?: number;
  latestPriorAssistantMessage: string;
  latestPriorMessageRole: string;
  recentMessages: TranscriptMessage[];
}

const replyDecisionSchema = z.object({
  should_reply: z.boolean(),
  should_unsubscribe: z.boolean().optional(),
  confidence: z.number().min(0).max(1),
  reason: z.string().optional(),
});

const LEADING_SLACK_MENTION_RE = /^\s*<@([A-Z0-9]+)(?:\|([^>]+))?>[\s,:-]*/i;
const LEADING_NAMED_MENTION_RE = /^\s*@([a-z0-9._-]+)\b[\s,:-]*/i;
const TRANSCRIPT_MESSAGE_LINE_RE =
  /^\[(assistant|system|user)\]\s+([^:]+):\s+([\s\S]+)$/i;
const THREAD_OPTOUT_PATTERNS = [
  /\bstop (?:watching|replying|participating)\b/i,
  /\bstay out\b/i,
  /\bdon['’]t (?:reply|participate|watch)\b/i,
  /\bunsubscribe\b/i,
  /\bleave (?:this )?thread\b/i,
];
const ACKNOWLEDGMENT_ONLY_RE =
  /^(?:thanks(?: you)?|thank you|thx|ty|got it|sounds good|sgtm|lgtm|ok(?:ay)?|cool|nice|perfect|awesome|great|makes sense|understood|roger|yep|yup|kk|on it|will do)(?:[.!]+)?$/i;
const DIRECTED_FOLLOW_UP_CUE_RE =
  /\b(?:you said|you just said|your last response|your last answer|what did you just say|what do you mean|what did you mean|explain(?: that| this| it| more)?|clarify(?: that| this| it)?|expand(?: on)?(?: that| this| it)?|elaborate(?: on)?(?: that| this| it)?|say more)\b/i;
const TERSE_CLARIFICATION_RE =
  /^(?:which one|which ones|why|how so|what do you mean|what did you mean|say more|explain that|clarify that|expand on that|elaborate on that)\??$/i;
const GENERIC_IMMEDIATE_SIDE_CONVERSATION_RE =
  /^(?:is that (?:the )?right (?:approach|call|move)|(?:can|could|would) you check on this)\??$/i;
const RECENT_THREAD_WINDOW = 6;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsAssistantInvocation(
  text: string,
  botUserName: string,
): boolean {
  const escapedUserName = escapeRegExp(botUserName);
  const plainNameMentionRe = new RegExp(`(^|\\s)@${escapedUserName}\\b`, "i");
  const labeledEntityMentionRe = new RegExp(
    `<@[^>|]+\\|${escapedUserName}>`,
    "i",
  );

  return plainNameMentionRe.test(text) || labeledEntityMentionRe.test(text);
}

function detectLeadingOtherPartyAddress(
  rawText: string,
  text: string,
  botUserName: string,
): string | undefined {
  if (
    containsAssistantInvocation(rawText, botUserName) ||
    containsAssistantInvocation(text, botUserName)
  ) {
    return undefined;
  }

  const leadingSlackMention = rawText.match(LEADING_SLACK_MENTION_RE);
  if (leadingSlackMention) {
    const label = leadingSlackMention[2]?.trim();
    return label ? `slack_mention:${label}` : "slack_mention";
  }

  const leadingNamedMention = text.match(LEADING_NAMED_MENTION_RE);
  if (!leadingNamedMention) {
    return undefined;
  }

  const directedName = leadingNamedMention[1]?.trim();
  if (
    !directedName ||
    directedName.toLowerCase() === botUserName.toLowerCase()
  ) {
    return undefined;
  }

  return `named_mention:${directedName}`;
}

function isThreadOptOutInstruction(rawText: string, text: string): boolean {
  return THREAD_OPTOUT_PATTERNS.some(
    (pattern) => pattern.test(rawText) || pattern.test(text),
  );
}

function isAcknowledgmentOnly(text: string): boolean {
  return ACKNOWLEDGMENT_ONLY_RE.test(text.trim());
}

function hasDirectedFollowUpCue(text: string): boolean {
  return DIRECTED_FOLLOW_UP_CUE_RE.test(text.trim());
}

function isTerseClarification(text: string): boolean {
  return TERSE_CLARIFICATION_RE.test(text.trim());
}

function isGenericImmediateSideConversation(text: string): boolean {
  const trimmed = text.trim();
  if (GENERIC_IMMEDIATE_SIDE_CONVERSATION_RE.test(trimmed)) {
    return true;
  }

  if (!trimmed.toLowerCase().startsWith("what about")) {
    return false;
  }

  const wordCount = trimmed
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean).length;
  return wordCount > 3;
}

function parseTranscriptMessages(
  conversationContext: string | undefined,
): TranscriptMessage[] {
  if (!conversationContext) {
    return [];
  }

  const messages: TranscriptMessage[] = [];
  const lines = conversationContext
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  for (const line of lines) {
    const match = line.match(TRANSCRIPT_MESSAGE_LINE_RE);
    if (!match) {
      continue;
    }

    messages.push({
      role: match[1].toLowerCase() as TranscriptMessage["role"],
      author: match[2]?.trim() || "unknown",
      text: match[3]?.trim() || "",
    });
  }

  return messages;
}

function buildRouterSignals(input: SubscribedDecisionInput): RouterSignals {
  const transcriptMessages = parseTranscriptMessages(input.conversationContext);
  const recentMessages = transcriptMessages
    .filter((message) => message.role !== "system")
    .slice(-RECENT_THREAD_WINDOW);

  const latestPriorMessage = [...transcriptMessages]
    .reverse()
    .find((message) => message.role !== "system");
  const latestPriorAssistantMessage = [...transcriptMessages]
    .reverse()
    .find((message) => message.role === "assistant");

  let humanMessagesSinceLastAssistant: number | undefined;
  let humanMessageCount = 0;
  for (let index = transcriptMessages.length - 1; index >= 0; index -= 1) {
    const message = transcriptMessages[index];
    if (!message || message.role === "system") {
      continue;
    }
    if (message.role === "assistant") {
      humanMessagesSinceLastAssistant = humanMessageCount;
      break;
    }
    humanMessageCount += 1;
  }

  return {
    assistantWasLastSpeaker: latestPriorMessage?.role === "assistant",
    currentMessageHasDirectedFollowUpCue: hasDirectedFollowUpCue(input.text),
    currentMessageHasAttachments: Boolean(input.hasAttachments),
    currentMessageIsTerseClarification: isTerseClarification(input.text),
    humanMessagesSinceLastAssistant,
    latestPriorAssistantMessage: latestPriorAssistantMessage?.text || "[none]",
    latestPriorMessageRole: latestPriorMessage?.role || "[none]",
    recentMessages,
  };
}

/** Fast heuristic check before the LLM classifier — skips messages directed at another party. */
export function getSubscribedReplyPreflightDecision(args: {
  botUserName: string;
  rawText: string;
  text: string;
  isExplicitMention?: boolean;
}): SubscribedDecisionResult | undefined {
  const text = args.text.trim();
  const rawText = args.rawText.trim();

  if (args.isExplicitMention) {
    return undefined;
  }

  const leadingOtherPartyAddress = detectLeadingOtherPartyAddress(
    rawText,
    text,
    args.botUserName,
  );
  if (!leadingOtherPartyAddress) {
    return undefined;
  }

  return {
    shouldReply: false,
    reason: SubscribedReplyReason.DirectedToOtherParty,
    reasonDetail: leadingOtherPartyAddress,
  };
}

/**
 * Decide whether to reply to a message in a subscribed Slack thread.
 *
 * The current policy is "let it happen": once a thread is subscribed
 * (because junior already engaged), reply to any non-trivial message.
 * Preflight checks still short-circuit obvious non-replies — empty
 * messages, acknowledgments, addressed-to-other-party leads, explicit
 * stop instructions, and generic immediate side-conversation questions.
 *
 * The `modelId` / `completeObject` / `logClassifierFailure` deps are
 * retained on the signature so callers (and tests) don't need to
 * change; the LLM classifier path is no longer exercised.
 */
export async function decideSubscribedThreadReply(args: {
  botUserName: string;
  modelId: string;
  input: SubscribedDecisionInput;
  completeObject: (args: {
    modelId: string;
    schema: typeof replyDecisionSchema;
    maxTokens: number;
    temperature: number;
    system: string;
    prompt: string;
    metadata: Record<string, string>;
  }) => Promise<{ object: unknown }>;
  logClassifierFailure: (
    error: unknown,
    input: SubscribedDecisionInput,
  ) => void;
}): Promise<SubscribedDecisionResult> {
  const text = args.input.text.trim();
  const rawText = args.input.rawText.trim();
  const preflightDecision = getSubscribedReplyPreflightDecision({
    botUserName: args.botUserName,
    rawText,
    text,
    isExplicitMention: args.input.isExplicitMention,
  });
  if (preflightDecision) {
    return preflightDecision;
  }
  const signals = buildRouterSignals(args.input);
  if (!text && !args.input.hasAttachments) {
    return { shouldReply: false, reason: SubscribedReplyReason.EmptyMessage };
  }
  if (
    !args.input.isExplicitMention &&
    !args.input.hasAttachments &&
    isAcknowledgmentOnly(text)
  ) {
    return {
      shouldReply: false,
      reason: SubscribedReplyReason.SideConversation,
      reasonDetail: "acknowledgment",
    };
  }

  if (args.input.isExplicitMention) {
    if (isThreadOptOutInstruction(rawText, text)) {
      return {
        shouldReply: false,
        shouldUnsubscribe: true,
        reason: SubscribedReplyReason.ThreadOptOut,
        reasonDetail: "explicit stop instruction",
      };
    }
    return {
      shouldReply: true,
      reason: SubscribedReplyReason.ExplicitMention,
    };
  }

  if (
    signals.assistantWasLastSpeaker &&
    signals.humanMessagesSinceLastAssistant === 0 &&
    !signals.currentMessageHasAttachments &&
    (signals.currentMessageHasDirectedFollowUpCue ||
      signals.currentMessageIsTerseClarification)
  ) {
    return {
      shouldReply: true,
      reason: SubscribedReplyReason.DirectedFollowUp,
      reasonDetail: signals.currentMessageIsTerseClarification
        ? "immediate terse clarification"
        : "immediate directed follow-up cue",
    };
  }

  if (isThreadOptOutInstruction(rawText, text)) {
    return {
      shouldReply: false,
      shouldUnsubscribe: true,
      reason: SubscribedReplyReason.ThreadOptOut,
      reasonDetail: "explicit stop instruction",
    };
  }

  if (
    signals.assistantWasLastSpeaker &&
    signals.humanMessagesSinceLastAssistant === 0 &&
    !signals.currentMessageHasAttachments &&
    !signals.currentMessageHasDirectedFollowUpCue &&
    !signals.currentMessageIsTerseClarification &&
    isGenericImmediateSideConversation(text)
  ) {
    return {
      shouldReply: false,
      reason: SubscribedReplyReason.SideConversation,
      reasonDetail: "generic immediate side conversation",
    };
  }

  // Default: subscribed threads always reply once junior has engaged.
  // The classifier path used to gate this through an LLM call, but in
  // practice that silenced junior whenever the routing model itself
  // failed (e.g. cursor cold-start hiccups) and was already overly
  // conservative. Explicit opt-out, acknowledgments, and the
  // directed-to-other-party preflight already handle the cases that
  // shouldn't trigger a reply.
  void args.modelId;
  void args.completeObject;
  void args.logClassifierFailure;
  return {
    shouldReply: true,
    reason: SubscribedReplyReason.SubscribedDefault,
  };
}
