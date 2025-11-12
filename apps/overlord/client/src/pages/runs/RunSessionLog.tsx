import {
  ActionIcon,
  Alert,
  Box,
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
import {
  GroupedLogComponent,
  groupPromptEntries,
} from "./LogEntries";
import { useAgentDataContext } from "../../contexts/AgentDataContext";
import { useContextLog } from "../../hooks/useContextLog";
import { RunSession } from "../../types/runSession";

export const RunSessionLog: React.FC<{
  run: RunSession;
  expanded: boolean;
  runSessionCardRef: React.RefObject<HTMLDivElement>;
}> = ({ run, expanded, runSessionCardRef }) => {
  const { agent: agentParam } = useParams<{ agent: string }>();
  const [fullscreen, setFullscreen] = useState(false);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const [scrollPanelIntoView, setScrollPanelIntoView] = useState(false);
  const savedScrollPercentage = useRef<number>(0);
  const [needsSyncScrolling, setNeedsSyncScrolling] = useState(false);
  const previousLogsLength = useRef<number>(0);

  const { updateReadStatus } = useAgentDataContext();

  // Fetch logs when expanded, but only continue polling if online
  const {
    logs,
    isLoading: logsLoading,
    error: logsError,
  } = useContextLog(
    run.userId,
    run.runId,
    run.sessionId,
    expanded,
    run.isOnline,
  );

  // Update read status when viewing logs
  useEffect(() => {
    const maxLogId = Math.max(...logs.map((log) => log.id), -1);
    updateReadStatus(agentParam || "", maxLogId, undefined);
  }, [logs]);

  // Scroll to bottom when first expanded with logs
  useEffect(() => {
    if (expanded) {
      setTimeout(() => setScrollPanelIntoView(true), 100);
    }
  }, [expanded]);

  // Auto-scroll to bottom when new logs arrive (if already at bottom or first load)
  useEffect(() => {
    if (!logContainerRef.current || logs.length === 0) return;

    const isFirstLoad = previousLogsLength.current === 0 && logs.length > 0;

    // Check if we're currently scrolled to the bottom before updating
    const { scrollTop, scrollHeight, clientHeight } = logContainerRef.current;
    const isAtBottom = scrollTop + clientHeight >= scrollHeight - 10;

    // Scroll to bottom if this is the first load OR if we're already at the bottom
    if (isFirstLoad || isAtBottom) {
      requestAnimationFrame(() => {
        if (logContainerRef.current) {
          logContainerRef.current.scrollTop =
            logContainerRef.current.scrollHeight;
        }
      });
    }

    previousLogsLength.current = logs.length;
  }, [logs]);

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

  useEffect(() => {
    if (expanded && scrollPanelIntoView && logs.length > 0) {
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
  }, [logs, expanded, scrollPanelIntoView, runSessionCardRef]);

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

  const renderLogView = (isFullscreen: boolean = false) => (
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
      {!isFullscreen && expanded && (
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
        style={{
          backgroundColor: "#1a1a1a",
          padding: "8px",
          borderRadius: "4px",
          maxHeight: isFullscreen ? "100vh" : "600px",
          height: isFullscreen ? "100vh" : "auto",
          overflowY: "auto",
        }}
      >
        {groupedLogs.map((item) => (
          <GroupedLogComponent
            key={
              Array.isArray(item)
                ? item.map((log) => log.id).join("-")
                : item.id
            }
            item={item}
          />
        ))}
        {logs.length === 0 && !logsLoading && (
          <Text size="sm" c="dimmed" ta="center">
            No logs available for this run
          </Text>
        )}
      </Stack>
    </Box>
  );

  return (
    <>
      <div style={{ display: expanded ? "block" : "none" }}>
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
