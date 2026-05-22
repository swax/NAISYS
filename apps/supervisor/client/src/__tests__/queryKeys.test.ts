import { describe, expect, test } from "vitest";

import { queryKeys } from "../lib/api/queryKeys";

describe("queryKeys", () => {
  test("chat thread keys keep the agent thread-list prefix", () => {
    const prefix = queryKeys.chatThreads("alice");
    const thread = queryKeys.chatThread("alice", "alice,bob");

    expect(thread.slice(0, prefix.length)).toEqual([...prefix]);
  });

  test("different agents do not share live-list keys", () => {
    expect(queryKeys.chatConversations("alice")).not.toEqual(
      queryKeys.chatConversations("bob"),
    );
    expect(queryKeys.mailData("alice")).not.toEqual(queryKeys.mailData("bob"));
  });
});
