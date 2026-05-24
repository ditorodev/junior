import { describe, expect, it, vi } from "vitest";
import {
  decideSubscribedThreadReply,
  getSubscribedReplyPreflightDecision,
  SubscribedReplyReason,
  type SubscribedDecisionInput,
} from "@/chat/services/subscribed-decision";

function makeInput(
  overrides: Partial<SubscribedDecisionInput> = {},
): SubscribedDecisionInput {
  return {
    rawText: "hello",
    text: "hello",
    hasAttachments: false,
    isExplicitMention: false,
    context: {},
    ...overrides,
  };
}

describe("decideSubscribedThreadReply", () => {
  it("preflight-skips a leading mention addressed to another named party", () => {
    const decision = getSubscribedReplyPreflightDecision({
      botUserName: "junior",
      rawText: "@Cursor can you take this one?",
      text: "@Cursor can you take this one?",
      isExplicitMention: false,
    });

    expect(decision).toEqual({
      shouldReply: false,
      reason: SubscribedReplyReason.DirectedToOtherParty,
      reasonDetail: "named_mention:Cursor",
    });
  });

  it("does not preflight-skip when junior is also addressed", () => {
    const decision = getSubscribedReplyPreflightDecision({
      botUserName: "junior",
      rawText: "@Cursor and @junior can one of you take this?",
      text: "@Cursor and @junior can one of you take this?",
      isExplicitMention: false,
    });

    expect(decision).toBeUndefined();
  });

  it("does not preflight-skip non-address mentions in the middle of the sentence", () => {
    const decision = getSubscribedReplyPreflightDecision({
      botUserName: "junior",
      rawText: "please ask @Cursor to look at this later",
      text: "please ask @Cursor to look at this later",
      isExplicitMention: false,
    });

    expect(decision).toBeUndefined();
  });

  it("replies directly to explicit mentions in subscribed threads", async () => {
    const completeObject = vi.fn(async () => ({
      object: {
        should_reply: true,
        confidence: 0.95,
        reason: "direct mention asking junior for help",
      },
    }));
    const decision = await decideSubscribedThreadReply({
      botUserName: "junior",
      modelId: "router-model",
      input: makeInput({ isExplicitMention: true }),
      completeObject,
      logClassifierFailure: vi.fn(),
    });

    expect(decision).toEqual({
      shouldReply: true,
      reason: SubscribedReplyReason.ExplicitMention,
    });
    expect(completeObject).not.toHaveBeenCalled();
  });

  it("short-circuits pure acknowledgment text without calling the classifier", async () => {
    const completeObject = vi.fn(async () => ({
      object: {
        should_reply: true,
        confidence: 1,
        reason: "this should never be used",
      },
    }));
    const decision = await decideSubscribedThreadReply({
      botUserName: "junior",
      modelId: "router-model",
      input: makeInput({ text: "thanks!", rawText: "thanks!" }),
      completeObject,
      logClassifierFailure: vi.fn(),
    });

    expect(decision).toEqual({
      shouldReply: false,
      reason: SubscribedReplyReason.SideConversation,
      reasonDetail: "acknowledgment",
    });
    expect(completeObject).not.toHaveBeenCalled();
  });

  it("replies to acknowledgment-shaped text when an attachment is included", async () => {
    const completeObject = vi.fn();
    const decision = await decideSubscribedThreadReply({
      botUserName: "junior",
      modelId: "router-model",
      input: makeInput({
        text: "thanks!",
        rawText: "thanks!",
        hasAttachments: true,
      }),
      completeObject,
      logClassifierFailure: vi.fn(),
    });

    expect(decision).toEqual({
      shouldReply: true,
      reason: SubscribedReplyReason.SubscribedDefault,
    });
    expect(completeObject).not.toHaveBeenCalled();
  });

  it("short-circuits immediate directed follow-ups after the assistant replied", async () => {
    const completeObject = vi.fn(async () => ({
      object: {
        should_reply: true,
        confidence: 0.95,
        reason: "follow-up to assistant response",
      },
    }));
    const decision = await decideSubscribedThreadReply({
      botUserName: "junior",
      modelId: "router-model",
      input: makeInput({
        text: "what did you just say about the budget?",
        rawText: "what did you just say about the budget?",
        conversationContext:
          "<thread-transcript>\n[assistant] junior: Budget is due Friday.\n</thread-transcript>",
      }),
      completeObject,
      logClassifierFailure: vi.fn(),
    });

    expect(decision).toEqual({
      shouldReply: true,
      reason: SubscribedReplyReason.DirectedFollowUp,
      reasonDetail: "immediate directed follow-up cue",
    });
    expect(completeObject).not.toHaveBeenCalled();
  });

  it("short-circuits immediate terse clarifications after the assistant replied", async () => {
    const completeObject = vi.fn(async () => ({
      object: {
        should_reply: false,
        confidence: 0.95,
        reason: "this should never be used",
      },
    }));
    const decision = await decideSubscribedThreadReply({
      botUserName: "junior",
      modelId: "router-model",
      input: makeInput({
        text: "Which one?",
        rawText: "Which one?",
        conversationContext:
          "<thread-transcript>\n[assistant] junior: The deploy changed billing, auth, and the API gateway.\n</thread-transcript>",
      }),
      completeObject,
      logClassifierFailure: vi.fn(),
    });

    expect(decision).toEqual({
      shouldReply: true,
      reason: SubscribedReplyReason.DirectedFollowUp,
      reasonDetail: "immediate terse clarification",
    });
    expect(completeObject).not.toHaveBeenCalled();
  });

  it("does not suppress acknowledgment text when it is an explicit mention", async () => {
    const completeObject = vi.fn(async () => ({
      object: {
        should_reply: true,
        confidence: 0.95,
        reason: "direct mention acknowledgment",
      },
    }));
    const decision = await decideSubscribedThreadReply({
      botUserName: "junior",
      modelId: "router-model",
      input: makeInput({
        text: "thanks!",
        rawText: "thanks!",
        isExplicitMention: true,
      }),
      completeObject,
      logClassifierFailure: vi.fn(),
    });

    expect(decision).toEqual({
      shouldReply: true,
      reason: SubscribedReplyReason.ExplicitMention,
    });
    expect(completeObject).not.toHaveBeenCalled();
  });

  it("still honors explicit stop instructions before mention short-circuiting", async () => {
    const decision = await decideSubscribedThreadReply({
      botUserName: "junior",
      modelId: "router-model",
      input: makeInput({
        rawText: "<@U_APP> stop watching or participating in this thread",
        text: "stop watching or participating in this thread",
        isExplicitMention: true,
      }),
      completeObject: vi.fn(),
      logClassifierFailure: vi.fn(),
    });

    expect(decision).toEqual({
      shouldReply: false,
      shouldUnsubscribe: true,
      reason: SubscribedReplyReason.ThreadOptOut,
      reasonDetail: "explicit stop instruction",
    });
  });

  it("skips leading slack mentions addressed to another party before classifier", async () => {
    const completeObject = vi.fn();
    const decision = await decideSubscribedThreadReply({
      botUserName: "junior",
      modelId: "router-model",
      input: makeInput({
        rawText: "<@UCURSOR> can you handle this?",
        text: "<@UCURSOR> can you handle this?",
        isExplicitMention: false,
      }),
      completeObject,
      logClassifierFailure: vi.fn(),
    });

    expect(decision).toEqual({
      shouldReply: false,
      reason: SubscribedReplyReason.DirectedToOtherParty,
      reasonDetail: "slack_mention",
    });
    expect(completeObject).not.toHaveBeenCalled();
  });

  it("skips empty message without attachments", async () => {
    const decision = await decideSubscribedThreadReply({
      botUserName: "junior",
      modelId: "router-model",
      input: makeInput({ text: "   ", rawText: "   " }),
      completeObject: vi.fn(),
      logClassifierFailure: vi.fn(),
    });

    expect(decision.reason).toBe(SubscribedReplyReason.EmptyMessage);
    expect(decision.shouldReply).toBe(false);
  });

  it("replies to attachment-only messages by default", async () => {
    const completeObject = vi.fn();
    const decision = await decideSubscribedThreadReply({
      botUserName: "junior",
      modelId: "router-model",
      input: makeInput({ text: "", rawText: "", hasAttachments: true }),
      completeObject,
      logClassifierFailure: vi.fn(),
    });

    expect(decision).toEqual({
      shouldReply: true,
      reason: SubscribedReplyReason.SubscribedDefault,
    });
    expect(completeObject).not.toHaveBeenCalled();
  });

  it("accepts lower-confidence clarification when junior was the last speaker", async () => {
    const decision = await decideSubscribedThreadReply({
      botUserName: "junior",
      modelId: "router-model",
      input: makeInput({
        text: "which one?",
        rawText: "which one?",
        conversationContext:
          "<thread-transcript>\n[assistant] junior: The deploy touched billing, auth, and API gateway.\n</thread-transcript>",
      }),
      completeObject: vi.fn(async () => ({
        object: {
          should_reply: true,
          confidence: 0.65,
          reason: "immediate clarification for assistant",
        },
      })),
      logClassifierFailure: vi.fn(),
    });

    expect(decision).toEqual({
      shouldReply: true,
      reason: SubscribedReplyReason.DirectedFollowUp,
      reasonDetail: "immediate terse clarification",
    });
  });

  it("skips a generic immediate question that does not clearly turn back to junior", async () => {
    const completeObject = vi.fn(async () => ({
      object: {
        should_reply: true,
        confidence: 1,
        reason: "this should never be used",
      },
    }));
    const decision = await decideSubscribedThreadReply({
      botUserName: "junior",
      modelId: "router-model",
      input: makeInput({
        text: "is that the right approach?",
        rawText: "is that the right approach?",
        conversationContext:
          "<thread-transcript>\n[assistant] junior: The deploy changed billing and auth.\n</thread-transcript>",
      }),
      completeObject,
      logClassifierFailure: vi.fn(),
    });

    expect(decision).toEqual({
      shouldReply: false,
      reason: SubscribedReplyReason.SideConversation,
      reasonDetail: "generic immediate side conversation",
    });
    expect(completeObject).not.toHaveBeenCalled();
  });

  it("replies to attachment-bearing follow-ups by default", async () => {
    const completeObject = vi.fn();
    const decision = await decideSubscribedThreadReply({
      botUserName: "junior",
      modelId: "router-model",
      input: makeInput({
        text: "can you check on this?",
        rawText: "can you check on this?",
        hasAttachments: true,
        conversationContext:
          "<thread-transcript>\n[assistant] junior: Please upload a screenshot.\n</thread-transcript>",
      }),
      completeObject,
      logClassifierFailure: vi.fn(),
    });

    expect(decision).toEqual({
      shouldReply: true,
      reason: SubscribedReplyReason.SubscribedDefault,
    });
    expect(completeObject).not.toHaveBeenCalled();
  });

  it("skips long 'what about' topic continuation after junior speaks", async () => {
    const completeObject = vi.fn(async () => ({
      object: {
        should_reply: true,
        confidence: 1,
        reason: "this should never be used",
      },
    }));
    const decision = await decideSubscribedThreadReply({
      botUserName: "junior",
      modelId: "router-model",
      input: makeInput({
        text: "what about the billing worker timeline?",
        rawText: "what about the billing worker timeline?",
        conversationContext:
          "<thread-transcript>\n[assistant] junior: The billing worker handles invoice retries.\n</thread-transcript>",
      }),
      completeObject,
      logClassifierFailure: vi.fn(),
    });

    expect(decision).toEqual({
      shouldReply: false,
      reason: SubscribedReplyReason.SideConversation,
      reasonDetail: "generic immediate side conversation",
    });
    expect(completeObject).not.toHaveBeenCalled();
  });

  it("replies after multi-human side discussion (no classifier gating)", async () => {
    const completeObject = vi.fn();
    const decision = await decideSubscribedThreadReply({
      botUserName: "junior",
      modelId: "router-model",
      input: makeInput({
        text: "what about the billing worker timeline?",
        rawText: "what about the billing worker timeline?",
        conversationContext: [
          "<thread-transcript>",
          "[assistant] junior: The deploy changed billing, auth, and the API gateway.",
          "[user] sam: I think we should revert auth first.",
          "[user] alex: I can take that rollback.",
          "</thread-transcript>",
        ].join("\n"),
      }),
      completeObject,
      logClassifierFailure: vi.fn(),
    });

    expect(decision).toEqual({
      shouldReply: true,
      reason: SubscribedReplyReason.SubscribedDefault,
    });
    expect(completeObject).not.toHaveBeenCalled();
  });

  it("honors explicit stop instructions even without a mention", async () => {
    const completeObject = vi.fn();
    const decision = await decideSubscribedThreadReply({
      botUserName: "junior",
      modelId: "router-model",
      input: makeInput({
        text: "please stop participating here",
        rawText: "please stop participating here",
      }),
      completeObject,
      logClassifierFailure: vi.fn(),
    });

    expect(decision).toEqual({
      shouldReply: false,
      shouldUnsubscribe: true,
      reason: SubscribedReplyReason.ThreadOptOut,
      reasonDetail: "explicit stop instruction",
    });
    expect(completeObject).not.toHaveBeenCalled();
  });

  it("replies to ambiguous follow-ups by default (no classifier needed)", async () => {
    const completeObject = vi.fn();
    const decision = await decideSubscribedThreadReply({
      botUserName: "junior",
      modelId: "router-model",
      input: makeInput({ text: "some new text", rawText: "some new text" }),
      completeObject,
      logClassifierFailure: vi.fn(),
    });

    expect(decision).toEqual({
      shouldReply: true,
      reason: SubscribedReplyReason.SubscribedDefault,
    });
    expect(completeObject).not.toHaveBeenCalled();
  });

  it("does not invoke the classifier even if a mock is supplied", async () => {
    const completeObject = vi.fn(async () => ({
      object: {
        should_reply: false,
        confidence: 0.95,
        reason: "this should never run",
      },
    }));
    const decision = await decideSubscribedThreadReply({
      botUserName: "junior",
      modelId: "router-model",
      input: makeInput({ text: "ping the api?", rawText: "ping the api?" }),
      completeObject,
      logClassifierFailure: vi.fn(),
    });

    expect(decision.shouldReply).toBe(true);
    expect(decision.reason).toBe(SubscribedReplyReason.SubscribedDefault);
    expect(completeObject).not.toHaveBeenCalled();
  });
});
