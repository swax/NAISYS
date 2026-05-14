import {
  Anchor,
  Box,
  Button,
  Container,
  Image,
  Paper,
  ScrollArea,
  Stack,
  Text,
} from "@mantine/core";
import { formatFileSize, isImageFilename } from "@naisys/common";
import { CompactMarkdown } from "@naisys/common-browser";
import { IconCheck, IconChecks, IconFile } from "@tabler/icons-react";
import React, { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { RunActivityRow } from "../../components/RunActivityRow";
import { useAgentDataContext } from "../../contexts/AgentDataContext";
import { useChatScroll } from "../../hooks/useChatScroll";
import type { ThreadRun } from "../../hooks/useMessageThreadRuns";
import type { ThreadRunCommand } from "../../hooks/useThreadRunCommands";
import { useThreadRunCommands } from "../../hooks/useThreadRunCommands";
import type { ChatMessage } from "../../lib/apiClient";
import { buildThreadRunActivity } from "../../lib/threadRunActivity";
import { bucketRunCommandsByMessage } from "../../lib/threadRunCommandBuckets";
import { ActiveSubagentBadge } from "./ActiveSubagentBadge";
import {
  formatDate,
  formatTime,
  otherStyle,
  ownStyle,
  runLogPath,
} from "./chatThreadHelpers";
import { CommandList } from "./CommandList";
import { PhantomBubble } from "./PhantomBubble";

interface ChatThreadProps {
  messages: ChatMessage[];
  currentAgentId: number;
  currentAgentUsername: string;
  total: number;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  participants: string[];
  runs: ThreadRun[];
}

export const ChatThread: React.FC<ChatThreadProps> = ({
  messages,
  currentAgentId,
  currentAgentUsername,
  total,
  hasMore,
  loadingMore,
  onLoadMore,
  participants,
  runs,
}) => {
  const navigate = useNavigate();
  const { agents } = useAgentDataContext();

  // Keyed by `${msgId}` (header), `${msgId}-footer`, `phantom-${username}`,
  // or `phantom-before-${msgId}-${username}`. Absence == collapsed.
  const [expandedBubbles, setExpandedBubbles] = useState<Set<string>>(
    new Set(),
  );

  // Older runs the user opened from a divider. Top-N is auto-loaded by the
  // commands hook; this set adds extras on demand.
  const [explicitlyLoadedRunIds, setExplicitlyLoadedRunIds] = useState<
    Set<number>
  >(new Set());

  const threadKey = participants.join(",");
  const lastMessageId = messages[messages.length - 1]?.id ?? null;

  const handleThreadChange = useCallback(() => {
    setExpandedBubbles(new Set());
    setExplicitlyLoadedRunIds(new Set());
  }, []);

  const { viewport, content, handleScrollPositionChange } = useChatScroll({
    threadKey,
    lastMessageId,
    messageCount: messages.length,
    onThreadChange: handleThreadChange,
  });

  const { beforeMessage: runActivity, trailing: trailingActivity } = useMemo(
    () => buildThreadRunActivity(messages, runs),
    [messages, runs],
  );

  const { entries: runCommands, loadedRunIds } = useThreadRunCommands(
    participants,
    runs,
    explicitlyLoadedRunIds,
  );

  const {
    beforeMessage: commandBuckets,
    afterMessage: footerCommandBuckets,
    phantomsBeforeMessage: intercalatedPhantoms,
    trailing: trailingCommands,
  } = useMemo(
    () => bucketRunCommandsByMessage(messages, runCommands, hasMore),
    [messages, runCommands, hasMore],
  );

  // Flips immediately on stop/pause/disconnect; lastActive takes ~15s to age
  // out, which would leave the spinner pulsing after the agent stopped.
  const activeAgentUsernames = useMemo(() => {
    const set = new Set<string>();
    for (const a of agents) {
      if (a.status === "active") set.add(a.name);
    }
    return set;
  }, [agents]);

  const onlineUsernames = useMemo(() => {
    const set = new Set<string>();
    for (const r of runs) {
      if (!r.isOnline || !r.username) continue;
      if (!activeAgentUsernames.has(r.username)) continue;
      set.add(r.username);
    }
    return set;
  }, [runs, activeAgentUsernames]);

  // Server stamps the live count on parent rows; iterating subagent rows here
  // would double-count. isOnline gate matches the command-spinner rule: a
  // missed zero-count heartbeat can leave activeSubagentCount stale, so once
  // lastActive ages out we stop trusting the count.
  const activeSubagentCountByUsername = useMemo(() => {
    const map = new Map<string, number>();
    const seenParentRuns = new Set<string>();
    for (const r of runs) {
      const count = r.activeSubagentCount ?? 0;
      if (count === 0 || !r.username) continue;
      if (!r.isOnline) continue;
      if (!activeAgentUsernames.has(r.username)) continue;
      if (r.subagentId != null && r.subagentId !== 0) continue;
      const parentKey = `${r.userId}-${r.runId}`;
      if (seenParentRuns.has(parentKey)) continue;
      seenParentRuns.add(parentKey);
      map.set(r.username, (map.get(r.username) ?? 0) + count);
    }
    return map;
  }, [runs, activeAgentUsernames]);

  // Latest activity by any user that lives outside the message bubbles. Used
  // to decide whether a footer on the last message is the true trailing edge
  // of the thread (and so should pulse).
  const latestTrailingCommandTime = useMemo(() => {
    let max = 0;
    for (const cmds of trailingCommands.values()) {
      for (const cmd of cmds) {
        const t = new Date(cmd.createdAt).getTime();
        if (t > max) max = t;
      }
    }
    return max;
  }, [trailingCommands]);

  const titleFor = useCallback(
    (username: string) => agents.find((a) => a.name === username)?.title ?? "",
    [agents],
  );

  // Fallback for users not in the agents list (legacy / external participants).
  const titleFromMessages = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of messages) {
      if (m.fromTitle) map.set(m.fromUsername, m.fromTitle);
    }
    return map;
  }, [messages]);

  const displayTitle = useCallback(
    (username: string) =>
      titleFor(username) || titleFromMessages.get(username) || "",
    [titleFor, titleFromMessages],
  );

  const toggleExpanded = useCallback((key: string) => {
    setExpandedBubbles((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const handleCommandClick = useCallback(
    (cmd: ThreadRunCommand) => {
      void navigate(runLogPath(cmd));
    },
    [navigate],
  );

  const handleLoadCommands = useCallback((runIds: number[]) => {
    setExplicitlyLoadedRunIds((prev) => {
      const next = new Set(prev);
      for (const id of runIds) next.add(id);
      return next;
    });
  }, []);

  if (messages.length === 0 && trailingCommands.size === 0) {
    return (
      <Box
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text c="dimmed">No messages yet. Start the conversation!</Text>
      </Box>
    );
  }

  let lastDate = "";

  const renderPhantomBubble = (
    username: string,
    cmds: ThreadRunCommand[],
    expansionKey: string,
    kind: "active" | "inactive" | "historical",
  ) => (
    <PhantomBubble
      key={expansionKey}
      username={username}
      title={displayTitle(username)}
      cmds={cmds}
      kind={kind}
      isOwn={username === currentAgentUsername}
      activeSubagentCount={activeSubagentCountByUsername.get(username) ?? 0}
      expanded={expandedBubbles.has(expansionKey)}
      onToggle={() => toggleExpanded(expansionKey)}
      onCommandClick={handleCommandClick}
    />
  );

  const lastMessage = messages[messages.length - 1] ?? null;
  const lastMessageUsername = lastMessage?.fromUsername ?? null;
  const lastMessageFooterCmds = lastMessage
    ? (footerCommandBuckets.get(lastMessage.id) ?? [])
    : [];
  const lastMessageFooterLastTime =
    lastMessageFooterCmds.length > 0
      ? new Date(
          lastMessageFooterCmds[lastMessageFooterCmds.length - 1].createdAt,
        ).getTime()
      : 0;
  // Whether the last message's footer will surface the subagent badge. When
  // it can't (another user has later trailing activity), the last-message
  // sender falls back to a trailing subagent-only phantom so the count is
  // still visible somewhere.
  const lastMessageFooterShowsSubagentBadge =
    lastMessageUsername !== null &&
    (activeSubagentCountByUsername.get(lastMessageUsername) ?? 0) > 0 &&
    onlineUsernames.has(lastMessageUsername) &&
    (lastMessageFooterCmds.length > 0
      ? lastMessageFooterLastTime >= latestTrailingCommandTime
      : latestTrailingCommandTime === 0);

  const trailingSubagentOnlyUsernames = Array.from(
    activeSubagentCountByUsername.keys(),
  )
    .filter((username) => !trailingCommands.has(username))
    .filter(
      (username) =>
        username !== lastMessageUsername ||
        !lastMessageFooterShowsSubagentBadge,
    )
    .sort((a, b) => a.localeCompare(b));

  return (
    <ScrollArea
      style={{ flex: 1 }}
      viewportRef={viewport}
      onScrollPositionChange={handleScrollPositionChange}
    >
      <Container ref={content} size="md" w="100%" p="md">
        <Stack gap="xs">
          {hasMore && (
            <Stack gap={4} align="center" py="xs">
              <Text c="dimmed" size="xs">
                Showing {messages.length} / {total} messages
              </Text>
              <Button
                variant="subtle"
                size="compact-xs"
                loading={loadingMore}
                onClick={onLoadMore}
              >
                Load Older Messages
              </Button>
            </Stack>
          )}
          {messages.map((msg) => {
            const isOwn = msg.fromUserId === currentAgentId;
            const msgDate = formatDate(msg.createdAt);
            const showDateDivider = msgDate !== lastDate;
            lastDate = msgDate;
            const cmds = commandBuckets.get(msg.id) ?? [];
            const footerCmds = footerCommandBuckets.get(msg.id) ?? [];
            // Footer spinner only when this footer holds the freshest activity
            // anywhere in the thread (no later message, no later trailing
            // command from another user) and the agent is still online — same
            // rule as the trailing phantom that footer commands replace.
            const footerLastTime =
              footerCmds.length > 0
                ? new Date(
                    footerCmds[footerCmds.length - 1].createdAt,
                  ).getTime()
                : 0;
            const footerActive =
              footerCmds.length > 0 &&
              msg.id === lastMessageId &&
              onlineUsernames.has(msg.fromUsername) &&
              footerLastTime >= latestTrailingCommandTime;
            const showFooterSubagentBadge =
              msg.id === lastMessageId && lastMessageFooterShowsSubagentBadge;
            const showFooterActivity =
              footerCmds.length > 0 || showFooterSubagentBadge;

            return (
              <React.Fragment key={msg.id}>
                {showDateDivider && (
                  <Text size="xs" c="dimmed" ta="center" py="xs">
                    {msgDate}
                  </Text>
                )}
                {runActivity.get(msg.id) && (
                  <RunActivityRow
                    activity={runActivity.get(msg.id)!}
                    currentAgentUsername={currentAgentUsername}
                    loadedRunIds={loadedRunIds}
                    onLoadCommands={handleLoadCommands}
                  />
                )}
                {/* Other users' command activity in this gap with no reply. */}
                {Array.from(intercalatedPhantoms.get(msg.id)?.entries() ?? [])
                  .map(([username, cmds]) => ({
                    username,
                    cmds,
                    latestTime: cmds[cmds.length - 1].createdAt,
                  }))
                  .sort(
                    (a, b) =>
                      new Date(a.latestTime).getTime() -
                      new Date(b.latestTime).getTime(),
                  )
                  .map(({ username, cmds }) =>
                    renderPhantomBubble(
                      username,
                      cmds,
                      `phantom-before-${msg.id}-${username}`,
                      "historical",
                    ),
                  )}
                <Box
                  style={{
                    display: "flex",
                    justifyContent: isOwn ? "flex-end" : "flex-start",
                  }}
                >
                  <Paper
                    p="xs"
                    px="sm"
                    radius="lg"
                    style={{
                      maxWidth: "75%",
                      ...(isOwn ? ownStyle : otherStyle),
                    }}
                  >
                    {!isOwn && (
                      <Text size="xs" fw={600} c="dimmed" mb={4}>
                        {msg.fromUsername} ({msg.fromTitle})
                      </Text>
                    )}
                    <CommandList
                      cmds={cmds}
                      isOwn={isOwn}
                      isActive={false}
                      isPhantom={false}
                      expanded={expandedBubbles.has(String(msg.id))}
                      onToggle={() => toggleExpanded(String(msg.id))}
                      onCommandClick={handleCommandClick}
                    />
                    <Text
                      component="div"
                      size="sm"
                      style={{
                        wordBreak: "break-word",
                        color: isOwn ? "white" : undefined,
                      }}
                    >
                      <CompactMarkdown>{msg.body}</CompactMarkdown>
                    </Text>
                    {msg.attachments && msg.attachments.length > 0 && (
                      <Stack gap={4} mt="xs">
                        {msg.attachments.map((att) => {
                          const downloadUrl = att.downloadUrl;
                          if (isImageFilename(att.filename)) {
                            return (
                              <Box key={att.id}>
                                <Image
                                  src={downloadUrl}
                                  alt={att.filename}
                                  maw={240}
                                  radius="sm"
                                  style={{ cursor: "pointer" }}
                                  onClick={() =>
                                    window.open(downloadUrl, "_blank")
                                  }
                                />
                                <Text
                                  size="xs"
                                  c={isOwn ? "rgba(255,255,255,0.7)" : "dimmed"}
                                  mt={2}
                                >
                                  {att.filename} ({formatFileSize(att.fileSize)}
                                  )
                                </Text>
                              </Box>
                            );
                          }
                          return (
                            <Anchor
                              key={att.id}
                              href={downloadUrl}
                              download
                              size="xs"
                              c={isOwn ? "white" : undefined}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 4,
                              }}
                            >
                              <IconFile size={14} />
                              {att.filename} ({formatFileSize(att.fileSize)})
                            </Anchor>
                          );
                        })}
                      </Stack>
                    )}
                    {showFooterActivity && (
                      <Box mt={4}>
                        {showFooterSubagentBadge && (
                          <ActiveSubagentBadge
                            count={
                              activeSubagentCountByUsername.get(
                                msg.fromUsername,
                              ) ?? 0
                            }
                            isOwn={isOwn}
                          />
                        )}
                        <CommandList
                          cmds={footerCmds}
                          isOwn={isOwn}
                          isActive={footerActive}
                          isPhantom={false}
                          expanded={expandedBubbles.has(`${msg.id}-footer`)}
                          onToggle={() => toggleExpanded(`${msg.id}-footer`)}
                          onCommandClick={handleCommandClick}
                        />
                      </Box>
                    )}
                    <Text
                      size="xs"
                      c={isOwn ? "rgba(255,255,255,0.7)" : "dimmed"}
                      ta="right"
                      mt={2}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "flex-end",
                        gap: 4,
                      }}
                    >
                      {formatTime(msg.createdAt)}
                      {isOwn &&
                        (msg.readBy && msg.readBy.length > 0 ? (
                          <IconChecks
                            size={14}
                            color="rgba(255,255,255,0.7)"
                            title="Read"
                          />
                        ) : (
                          <IconCheck
                            size={14}
                            color="rgba(255,255,255,0.7)"
                            title="Delivered"
                          />
                        ))}
                    </Text>
                  </Paper>
                </Box>
              </React.Fragment>
            );
          })}
          {/* Activity after the last message — in-progress or "no reply". */}
          {Array.from(trailingCommands.entries())
            .map(([username, cmds]) => ({
              username,
              cmds,
              latestTime: cmds[cmds.length - 1].createdAt,
            }))
            .sort(
              (a, b) =>
                new Date(a.latestTime).getTime() -
                new Date(b.latestTime).getTime(),
            )
            .map(({ username, cmds }) =>
              renderPhantomBubble(
                username,
                cmds,
                `phantom-${username}`,
                onlineUsernames.has(username) ? "active" : "inactive",
              ),
            )}
          {trailingSubagentOnlyUsernames.map((username) =>
            renderPhantomBubble(
              username,
              [],
              `phantom-subagents-${username}`,
              "active",
            ),
          )}
          {trailingActivity && (
            <RunActivityRow
              activity={trailingActivity}
              currentAgentUsername={currentAgentUsername}
              loadedRunIds={loadedRunIds}
              onLoadCommands={handleLoadCommands}
            />
          )}
        </Stack>
      </Container>
    </ScrollArea>
  );
};
