// Tests the dispatcher-level gate for `disableBlockStreaming`.
//
// AIDEV-NOTE: Regression test for the block-payload leak surfaced on
// 2026-07-02: channels that set `channels.<provider>.streaming.block.enabled=false`
// expect inter-tool assistant-text blocks to be dropped, but the plain
// (non-streamed) block path still enqueued each block through the reply
// dispatcher and produced one outbound `chat.postMessage` per inter-tool
// text block on Slack. The dispatcher now no-ops `sendBlockReply` when
// `disableBlockStreaming` is set, while leaving tool results and final
// replies untouched.
import { describe, expect, it } from "vitest";
import type { ReplyPayload } from "../types.js";
import { createReplyDispatcher } from "./reply-dispatcher.js";

describe("createReplyDispatcher with disableBlockStreaming", () => {
  it("drops block replies without delivering them", async () => {
    const delivered: Array<{ kind: string; text: string }> = [];

    const dispatcher = createReplyDispatcher({
      deliver: async (payload, info) => {
        delivered.push({ kind: info.kind, text: payload.text ?? "" });
      },
      disableBlockStreaming: true,
    });

    // Block replies are silently dropped and report as not-enqueued.
    expect(dispatcher.sendBlockReply({ text: "inter-tool block one" } as ReplyPayload)).toBe(false);
    expect(dispatcher.sendBlockReply({ text: "inter-tool block two" } as ReplyPayload)).toBe(false);

    // Tool results and final replies still go through as before.
    expect(dispatcher.sendToolResult({ text: "tool result" } as ReplyPayload)).toBe(true);
    expect(dispatcher.sendFinalReply({ text: "final answer" } as ReplyPayload)).toBe(true);

    dispatcher.markComplete();
    await dispatcher.waitForIdle();

    expect(delivered).toEqual([
      { kind: "tool", text: "tool result" },
      { kind: "final", text: "final answer" },
    ]);
    // Queued counts reflect actual work performed: no block enqueues.
    expect(dispatcher.getQueuedCounts()).toEqual({ tool: 1, block: 0, final: 1 });
    // The drops are not counted as cancellations (they never entered the
    // queue), matching the semantics of a normalization skip.
    expect(dispatcher.getCancelledCounts?.()).toEqual({ tool: 0, block: 0, final: 0 });
  });

  it("delivers block replies as usual when disableBlockStreaming is unset", async () => {
    const delivered: Array<{ kind: string; text: string }> = [];

    const dispatcher = createReplyDispatcher({
      deliver: async (payload, info) => {
        delivered.push({ kind: info.kind, text: payload.text ?? "" });
      },
    });

    expect(dispatcher.sendBlockReply({ text: "block one" } as ReplyPayload)).toBe(true);
    expect(dispatcher.sendBlockReply({ text: "block two" } as ReplyPayload)).toBe(true);
    dispatcher.markComplete();
    await dispatcher.waitForIdle();

    expect(delivered).toEqual([
      { kind: "block", text: "block one" },
      { kind: "block", text: "block two" },
    ]);
    expect(dispatcher.getQueuedCounts()).toEqual({ tool: 0, block: 2, final: 0 });
  });

  it("delivers block replies as usual when disableBlockStreaming is explicitly false", async () => {
    const delivered: string[] = [];

    const dispatcher = createReplyDispatcher({
      deliver: async (payload) => {
        delivered.push(payload.text ?? "");
      },
      disableBlockStreaming: false,
    });

    expect(dispatcher.sendBlockReply({ text: "keeps flowing" } as ReplyPayload)).toBe(true);
    dispatcher.markComplete();
    await dispatcher.waitForIdle();

    expect(delivered).toEqual(["keeps flowing"]);
  });
});
