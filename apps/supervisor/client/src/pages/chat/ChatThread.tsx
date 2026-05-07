import {
  Anchor,
  Box,
  Button,
  Container,
  Group,
  Image,
  Loader,
  Paper,
  ScrollArea,
  Stack,
  Text,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { formatFileSize, isImageFilename } from "@naisys/common";
import { CompactMarkdown } from "@naisys/common-browser";
import {
  IconCheck,
  IconChecks,
  IconChevronDown,
  IconFile,
} from "@tabler/icons-react";
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";

import { RunDividerLine } from "../../components/RunDividerLine";
import { useAgentDataContext } from "../../contexts/AgentDataContext";
import type { ThreadRunCommand } from "../../hooks/useThreadRunCommands";
import { useThreadRunCommands } from "../../hooks/useThreadRunCommands";
import { useThreadRuns } from "../../hooks/useThreadRuns";
import type { ChatMessage } from "../../lib/apiClient";
import { bucketRunCommandsByMessage } from "../../lib/threadRunCommandBuckets";
import { buildThreadDividers } from "../../lib/threadRunDividers";

interface ChatThreadProps {
  messages: ChatMessage[];
  currentAgentId: number;
  currentAgentUsername: string;
  total: number;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  participants: string[];
}

const BOTTOM_STICKINESS_PX = 24;

const firstLine = (s: string) => {
  const idx = s.indexOf("\n");
  return idx === -1 ? s : s.slice(0, idx);
};

const TOOLTIP_MAX_CHARS = 2000;
const tooltipText = (s: string) =>
  s.length > TOOLTIP_MAX_CHARS
    ? `${s.slice(0, TOOLTIP_MAX_CHARS)}\n…(truncated, ${s.length - TOOLTIP_MAX_CHARS} more chars — click to view)`
    : s;

const runLogPath = (cmd: ThreadRunCommand) => {
  const base = `/agents/${cmd.username}/runs/${cmd.runId}`;
  const tail = `/sessions/${cmd.sessionId}?focusLogId=${cmd.logId}`;
  return cmd.subagentId !== null && cmd.subagentId !== 0
    ? `${base}/subagents/${cmd.subagentId}${tail}`
    : `${base}${tail}`;
};

export const ChatThread: React.FC<ChatThreadProps> = ({
  messages,
  currentAgentId,
  currentAgentUsername,
  total,
  hasMore,
  loadingMore,
  onLoadMore,
  participants,
}) => {
  const navigate = useNavigate();
  const { agents } = useAgentDataContext();
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const shouldStickToBottom = useRef(true);
  const lastScrollTop = useRef(0);
  const scrollFrame = useRef<number | null>(null);
  const previousThread = useRef<{
    threadKey: string;
    lastMessageId: number | null;
  }>({
    threadKey: "",
    lastMessageId: null,
  });

  // Per-bubble expansion state. Keyed by message id (settled bubbles) or
  // `phantom-${username}` (in-progress bubbles). Default is collapsed, so
  // an absent key means collapsed.
  const [expandedBubbles, setExpandedBubbles] = useState<Set<string>>(
    new Set(),
  );

  // RunIds the user has explicitly opened from a divider. The hook always
  // auto-loads the top-N latest runs per participant; this set adds older
  // runs on demand.
  const [explicitlyLoadedRunIds, setExplicitlyLoadedRunIds] = useState<
    Set<number>
  >(new Set());

  const threadKey = participants.join(",");
  const lastMessageId = messages[messages.length - 1]?.id ?? null;

  const scrollToBottom = useCallback(() => {
    const applyScroll = () => {
      const node = viewport.current;
      if (!node) return;

      node.scrollTop = node.scrollHeight;
      lastScrollTop.current = node.scrollTop;
    };

    applyScroll();

    if (scrollFrame.current !== null) {
      window.cancelAnimationFrame(scrollFrame.current);
    }

    scrollFrame.current = window.requestAnimationFrame(() => {
      scrollFrame.current = null;
      applyScroll();
    });
  }, []);

  const handleScrollPositionChange = useCallback(() => {
    const node = viewport.current;
    if (!node) return;

    const distanceFromBottom =
      node.scrollHeight - node.clientHeight - node.scrollTop;
    const isAtBottom = distanceFromBottom <= BOTTOM_STICKINESS_PX;
    const movedUp = node.scrollTop < lastScrollTop.current - 1;

    // Late content growth can move the bottom without a user action. Only an
    // actual upward scroll should disable bottom stickiness.
    if (isAtBottom) {
      shouldStickToBottom.current = true;
    } else if (movedUp) {
      shouldStickToBottom.current = false;
    }

    lastScrollTop.current = node.scrollTop;
  }, []);

  useEffect(() => {
    return () => {
      if (scrollFrame.current !== null) {
        window.cancelAnimationFrame(scrollFrame.current);
      }
    };
  }, []);

  // Auto-scroll on conversation load and when newer messages append. Loading
  // older messages keeps the same last message id, so it does not pull the
  // viewport back down.
  useLayoutEffect(() => {
    const previous = previousThread.current;
    const threadChanged = previous.threadKey !== threadKey;
    const lastMessageChanged = lastMessageId !== previous.lastMessageId;

    if (threadChanged) {
      shouldStickToBottom.current = true;
      // Reset per-bubble expansions and any explicitly-loaded runs when
      // switching conversations.
      setExpandedBubbles(new Set());
      setExplicitlyLoadedRunIds(new Set());
    }

    if (
      messages.length > 0 &&
      (threadChanged || (lastMessageChanged && shouldStickToBottom.current))
    ) {
      scrollToBottom();
    }

    previousThread.current = {
      threadKey,
      lastMessageId,
    };
  }, [lastMessageId, messages.length, scrollToBottom, threadKey]);

  // Keep the latest message visible when content height changes after the
  // initial scroll, for example when image attachments or run dividers load.
  useEffect(() => {
    if (
      messages.length === 0 ||
      !content.current ||
      typeof ResizeObserver === "undefined"
    ) {
      return;
    }

    const node = content.current;
    const observer = new ResizeObserver(() => {
      if (shouldStickToBottom.current) {
        scrollToBottom();
      }
    });

    observer.observe(node);
    return () => observer.disconnect();
  }, [messages.length, scrollToBottom, threadKey]);

  const oldestMessageTime = useMemo(() => {
    if (messages.length === 0) return null;
    let oldest = messages[0].createdAt;
    for (const m of messages) {
      if (new Date(m.createdAt).getTime() < new Date(oldest).getTime()) {
        oldest = m.createdAt;
      }
    }
    return oldest;
  }, [messages]);

  const { runs } = useThreadRuns(participants, oldestMessageTime);

  const { beforeMessage: runDividers, trailing: trailingDivider } = useMemo(
    () => buildThreadDividers(messages, runs),
    [messages, runs],
  );

  const { entries: runCommands, loadedRunIds } = useThreadRunCommands(
    participants,
    runs,
    explicitlyLoadedRunIds,
  );

  const { beforeMessage: commandBuckets, trailing: trailingCommands } = useMemo(
    () => bucketRunCommandsByMessage(messages, runCommands),
    [messages, runCommands],
  );

  // Active state is per-username: any of that user's runs is online.
  const onlineUsernames = useMemo(() => {
    const set = new Set<string>();
    for (const r of runs) {
      if (r.isOnline && r.username) set.add(r.username);
    }
    return set;
  }, [runs]);

  const titleFor = useCallback(
    (username: string) => agents.find((a) => a.name === username)?.title ?? "",
    [agents],
  );

  // Latest fromTitle per username from messages — fallback for users not in
  // the agents list (e.g. legacy or external participants).
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

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) return "Today";
    if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
    return date.toLocaleDateString();
  };

  const renderCommandList = (
    cmds: ThreadRunCommand[],
    expansionKey: string,
    isOwn: boolean,
    isActive: boolean,
    isPhantom: boolean,
  ) => {
    if (cmds.length === 0) return null;

    const expanded = expandedBubbles.has(expansionKey);
    // Settled bubble: collapsed shows just the toggle.
    // Phantom bubble: collapsed shows the latest command (so you can see what
    // the agent is working on right now without clicking).
    const visible = expanded ? cmds : isPhantom ? [cmds[cmds.length - 1]] : [];
    const latestId = cmds[cmds.length - 1].logId;
    // Phantom with a single cmd doesn't need a toggle — there's nothing to
    // expand to. Settled always shows the toggle since it carries the count.
    const showToggle = !isPhantom || cmds.length > 1;

    const dimColor = isOwn ? "rgba(255,255,255,0.7)" : "dimmed";
    const cmdColor = isOwn ? "rgba(255,255,255,0.92)" : "magenta.4";
    const countLabel = `Ran ${cmds.length} ${cmds.length === 1 ? "command" : "commands"}`;

    return (
      <Stack gap={0} mb={4}>
        {showToggle && (
          <UnstyledButton
            onClick={() => toggleExpanded(expansionKey)}
            style={{ alignSelf: "flex-start" }}
          >
            <Group gap={2} wrap="nowrap">
              <IconChevronDown
                size={12}
                style={{
                  transform: expanded ? "rotate(0deg)" : "rotate(-90deg)",
                  transition: "transform 0.15s",
                  color: isOwn
                    ? "rgba(255,255,255,0.7)"
                    : "var(--mantine-color-dimmed)",
                }}
              />
              <Text size="xs" c={dimColor}>
                {countLabel}
              </Text>
            </Group>
          </UnstyledButton>
        )}
        {visible.map((cmd) => {
          const showSpinner = isActive && cmd.logId === latestId;
          return (
            <Tooltip
              key={cmd.logId}
              label={tooltipText(cmd.message)}
              multiline
              w={480}
              openDelay={300}
              withinPortal
              position="top-start"
              styles={{
                tooltip: {
                  fontFamily: "monospace",
                  fontSize: 11,
                  whiteSpace: "pre-wrap",
                },
              }}
            >
              <UnstyledButton
                onClick={() => handleCommandClick(cmd)}
                style={{ minWidth: 0, width: "100%" }}
              >
                <Group gap={2} wrap="nowrap" align="center">
                  {/* 12px gutter aligns command text with the "Ran N" toggle
                      label. Holds the spinner for the latest active command. */}
                  <Box
                    w={12}
                    h={12}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    {showSpinner && (
                      <Loader
                        size={10}
                        type="dots"
                        color={isOwn ? "white" : "blue"}
                      />
                    )}
                  </Box>
                  <Text
                    size="xs"
                    c={cmdColor}
                    style={{
                      fontFamily: "monospace",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      minWidth: 0,
                      flex: 1,
                    }}
                  >
                    {firstLine(cmd.message)}
                  </Text>
                </Group>
              </UnstyledButton>
            </Tooltip>
          );
        })}
      </Stack>
    );
  };

  // Group messages by date
  let lastDate = "";

  const ownStyle = {
    backgroundColor: "var(--mantine-color-blue-filled)" as const,
  };
  const otherStyle = {
    backgroundColor: "var(--mantine-color-dark-5)" as const,
  };

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

            return (
              <React.Fragment key={msg.id}>
                {showDateDivider && (
                  <Text size="xs" c="dimmed" ta="center" py="xs">
                    {msgDate}
                  </Text>
                )}
                {runDividers.get(msg.id) && (
                  <RunDividerLine
                    divider={runDividers.get(msg.id)!}
                    currentAgentUsername={currentAgentUsername}
                    loadedRunIds={loadedRunIds}
                    onLoadCommands={handleLoadCommands}
                  />
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
                      <Text size="xs" fw={600} c="dimmed" mb={2}>
                        {msg.fromUsername} ({msg.fromTitle})
                      </Text>
                    )}
                    {renderCommandList(
                      cmds,
                      String(msg.id),
                      isOwn,
                      false,
                      false,
                    )}
                    <Text
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
          {/* Phantom bubbles for in-progress / unanswered turns. Sorted by
              latest command time so they appear in the natural place. */}
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
            .map(({ username, cmds }) => {
              const isOwn = username === currentAgentUsername;
              const isActive = onlineUsernames.has(username);
              const expansionKey = `phantom-${username}`;
              const title = displayTitle(username);
              return (
                <Box
                  key={expansionKey}
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
                      border: isActive
                        ? "1px solid var(--mantine-color-blue-4)"
                        : "1px dashed var(--mantine-color-dark-3)",
                    }}
                  >
                    {!isOwn && (
                      <Text size="xs" fw={600} c="dimmed" mb={2}>
                        {username}
                        {title ? ` (${title})` : ""}
                      </Text>
                    )}
                    {renderCommandList(
                      cmds,
                      expansionKey,
                      isOwn,
                      isActive,
                      true,
                    )}
                    {!isActive && (
                      <Text
                        size="xs"
                        fs="italic"
                        c={isOwn ? "rgba(255,255,255,0.7)" : "dimmed"}
                      >
                        (no reply)
                      </Text>
                    )}
                  </Paper>
                </Box>
              );
            })}
          {trailingDivider && (
            <RunDividerLine
              divider={trailingDivider}
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
