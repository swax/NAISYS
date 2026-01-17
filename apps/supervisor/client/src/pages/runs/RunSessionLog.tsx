import {
  ActionIcon,
  Alert,
  Box,
  Divider,
  Group,
  Loader,
  Portal,
  Stack,
  Text,
} from "@mantine/core";
import {
  IconArrowBarToDown,
  IconArrowBarToUp,
  IconMaximize,
  IconMinimize,
} from "@tabler/icons-react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useAgentDataContext } from "../../contexts/AgentDataContext";
import { useContextLog } from "../../hooks/useContextLog";
import { RunSession } from "../../types/runSession";
import { GroupedLogComponent, groupPromptEntries } from "./LogEntries";

export const RunSessionLog: React.FC<{
  run: RunSession;
  runSessionCardRef: React.RefObject<HTMLDivElement | null>;
}> = ({ run, runSessionCardRef }) => {
  const { agent: agentParam } = useParams<{ agent: string }>();
  const [fullscreen, setFullscreen] = useState(false);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const [, setScrollPanelIntoView] = useState(true);
  const savedScrollPercentage = useRef<number>(0);
  const [needsSyncScrolling, setNeedsSyncScrolling] = useState(false);
  const previousLogsLength = useRef<number>(0);
  const wasAtBottomRef = useRef<boolean>(true); // Track if we were at bottom before render
  const { updateReadStatus, readStatus } = useAgentDataContext();

  // Save the initial lastReadLogId to determine where to show the divider
  const [dividerLogId] = useState<string | undefined>(
    agentParam ? readStatus[agentParam]?.lastReadLogId : undefined,
  );

  // Fetch logs when expanded, but only continue polling if online
  const {
    logs,
    isLoading: logsLoading,
    error: logsError,
  } = useContextLog(run.userId, run.runId, run.sessionId, true, run.isOnline);

  // Scroll to bottom when first expanded with logs
  useEffect(() => {
    if (logs.length > 0) {
      // If runSessionCardRef not in full view then scroll it into view
      if (runSessionCardRef.current) {
        const rect = runSessionCardRef.current.getBoundingClientRect();
        if (
          rect.top < 0 ||
          rect.bottom >
            (window.innerHeight || document.documentElement.clientHeight)
        ) {
          runSessionCardRef.current?.scrollIntoView({
            behavior: "instant",
            block: "end",
          });
        }
      }
      setScrollPanelIntoView(false);
    }
  }, [logs, runSessionCardRef]);

  // Track scroll position to know if we should auto-scroll when new content arrives
  const handleScroll = useCallback(() => {
    if (!logContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = logContainerRef.current;
    const isAtBottom = scrollTop + clientHeight >= scrollHeight - 16;
    wasAtBottomRef.current = isAtBottom;
  }, []);

  useEffect(() => {
    // Update read status when viewing logs
    // Find max ULID using string comparison
    const maxLogId = logs.reduce(
      (max, log) => (log.id > max ? log.id : max),
      "",
    );
    updateReadStatus(agentParam || "", maxLogId, undefined);

    // Auto-scroll to bottom when new logs arrive (if already at bottom or first load)
    if (!logContainerRef.current || logs.length === 0) return;

    const isFirstLoad = previousLogsLength.current === 0 && logs.length > 0;

    // Use the wasAtBottomRef that was set BEFORE this render
    if (isFirstLoad || wasAtBottomRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
      wasAtBottomRef.current = true;
    }

    previousLogsLength.current = logs.length;
  }, [agentParam, logs, updateReadStatus]);

  const toggleFullscreen = useCallback((value: boolean) => {
    // Save current scroll percentage before toggling
    if (logContainerRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = logContainerRef.current;
      const maxScroll = scrollHeight - clientHeight;
      savedScrollPercentage.current = maxScroll > 0 ? scrollTop / maxScroll : 0;
      setNeedsSyncScrolling(true);
    }
    setFullscreen(value);
  }, []);

  // Handle ESC key to exit fullscreen
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && fullscreen) {
        toggleFullscreen(false);
      }
    };

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [fullscreen, toggleFullscreen]);

  // Restore scroll position when toggling fullscreen
  useEffect(() => {
    if (!needsSyncScrolling) return;

    const timer = setTimeout(() => {
      if (logContainerRef.current) {
        const { scrollHeight, clientHeight } = logContainerRef.current;
        const maxScroll = scrollHeight - clientHeight;
        logContainerRef.current.scrollTop =
          savedScrollPercentage.current * maxScroll;

        setNeedsSyncScrolling(false);
      }
    }, 100);

    return () => clearTimeout(timer);
  }, [fullscreen, needsSyncScrolling]);

  const groupedLogs = groupPromptEntries(logs);

  const scrollToTop = () => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const scrollToBottom = () => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTo({
        top: logContainerRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  };

  const renderLogView = (isFullscreen: boolean = false) => {
    return (
      <Box style={{ position: "relative" }}>
        {isFullscreen && (
          <>
            <ActionIcon
              variant="filled"
              color="gray"
              onClick={() => toggleFullscreen(false)}
              size="lg"
              style={{
                position: "absolute",
                top: "8px",
                right: "24px",
                zIndex: 10,
              }}
              data-action-icon
            >
              <IconMinimize size={20} />
            </ActionIcon>
            <ActionIcon
              variant="filled"
              color="gray"
              onClick={scrollToTop}
              size="lg"
              style={{
                position: "absolute",
                top: "8px",
                right: "68px",
                zIndex: 10,
              }}
              data-action-icon
            >
              <IconArrowBarToUp size={20} />
            </ActionIcon>
            <ActionIcon
              variant="filled"
              color="gray"
              onClick={scrollToBottom}
              size="lg"
              style={{
                position: "absolute",
                top: "8px",
                right: "112px",
                zIndex: 10,
              }}
              data-action-icon
            >
              <IconArrowBarToDown size={20} />
            </ActionIcon>
          </>
        )}
        {!isFullscreen && (
          <ActionIcon
            variant="filled"
            color="gray"
            onClick={() => toggleFullscreen(true)}
            size="lg"
            style={{
              position: "absolute",
              top: "8px",
              right: "24px",
              zIndex: 10,
            }}
            data-action-icon
          >
            <IconMaximize size={20} />
          </ActionIcon>
        )}
        <Stack
          ref={fullscreen == isFullscreen ? logContainerRef : undefined}
          gap={0}
          onScroll={fullscreen == isFullscreen ? handleScroll : undefined}
          style={{
            backgroundColor: "#1a1a1a",
            padding: "8px",
            borderRadius: "4px",
            maxHeight: isFullscreen ? "100vh" : "600px",
            height: isFullscreen ? "100vh" : "auto",
            overflowY: "auto",
          }}
        >
          {groupedLogs.map((item) => {
            const key = Array.isArray(item)
              ? item.map((log) => log.id).join("-")
              : item.id;

            const lastItem = item === groupedLogs[groupedLogs.length - 1];

            const showDivider =
              !lastItem &&
              (Array.isArray(item)
                ? item.some((log) => log.id == dividerLogId)
                : item.id == dividerLogId);

            return (
              <React.Fragment key={key}>
                <GroupedLogComponent item={item} />
                {showDivider && (
                  <Divider
                    my="md"
                    label="New logs below"
                    labelPosition="center"
                    color="blue"
                    style={{
                      borderColor: "rgba(66, 153, 225, 0.5)",
                    }}
                  />
                )}
              </React.Fragment>
            );
          })}
          {logs.length === 0 && !logsLoading && (
            <Text size="sm" c="dimmed" ta="center">
              No logs available for this run
            </Text>
          )}
        </Stack>
      </Box>
    );
  };

  return (
    <>
      <div style={{ display: "block" }}>
        {logsError && (
          <Alert color="red" title="Error loading logs">
            {logsError instanceof Error
              ? logsError.message
              : "Failed to load logs"}
          </Alert>
        )}

        {logsLoading && logs.length === 0 && (
          <Group justify="center">
            <Loader size="sm" />
            <Text size="sm">Loading logs...</Text>
          </Group>
        )}

        {renderLogView(false)}
      </div>

      {fullscreen && (
        <Portal>
          <Box
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: "#1a1a1a",
              zIndex: 1000,
            }}
          >
            {renderLogView(true)}
          </Box>
        </Portal>
      )}
    </>
  );
};
