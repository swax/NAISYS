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
import {
  GroupedLogComponent,
  groupPromptEntries,
} from "../components/LogEntries";
import { useContextLog } from "../hooks/useContextLog";
import { LogEntry, RunSession } from "../lib/apiClient";

export const RunSessionLog: React.FC<{
  run: RunSession;
  expanded: boolean;
  runSessionCardRef: React.RefObject<HTMLDivElement>;
}> = ({ run, expanded, runSessionCardRef }) => {
  const [fullscreen, setFullscreen] = useState(false);
  const [allLogs, setAllLogs] = useState<LogEntry[]>([]);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const [scrollPanelIntoView, setScrollPanelIntoView] = useState(false);
  const savedScrollPercentage = useRef<number>(0);
  const [needsSyncScrolling, setNeedsSyncScrolling] = useState(false);

  // Fetch logs when expanded, but only continue polling if online
  const {
    data: logsResponse,
    isLoading: logsLoading,
    error: logsError,
  } = useContextLog(
    run.userId,
    run.runId,
    run.sessionId,
    expanded,
    run.isOnline,
  );

  // Scroll to bottom when first expanded with logs
  useEffect(() => {
    if (expanded) {
      setTimeout(() => setScrollPanelIntoView(true), 100);
    }
    // Wait for logs to load, and allLogs to update
  }, [expanded]); // Scroll to bottom when expanded changes to true

  // Update logs from polling responses
  useEffect(() => {
    if (logsResponse?.success && logsResponse.data) {
      const newLogs = logsResponse.data.logs;

      // Check if we're currently scrolled to the bottom before updating
      const shouldAutoScroll = (() => {
        if (!logContainerRef.current) return false;
        const { scrollTop, scrollHeight, clientHeight } =
          logContainerRef.current;
        // Consider "at bottom" if within 10px of the bottom
        return scrollTop + clientHeight >= scrollHeight - 10;
      })();

      setAllLogs((prevLogs) => {
        // If this is the first fetch, just use the new logs
        if (prevLogs.length === 0) {
          return newLogs;
        }

        // Create a map of existing logs for quick lookup
        const logsMap = new Map(prevLogs.map((log) => [log.id, log]));

        // Add new logs
        newLogs.forEach((log) => {
          logsMap.set(log.id, log);
        });

        // Convert back to array and sort by ID
        return Array.from(logsMap.values()).sort((a, b) => a.id - b.id);
      });

      // Scroll to bottom after state update if we should auto-scroll or if this is the first load
      requestAnimationFrame(() => {
        if (logContainerRef.current && shouldAutoScroll) {
          logContainerRef.current.scrollTop =
            logContainerRef.current.scrollHeight;
        }
      });
    }
  }, [logsResponse]);

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
    if (expanded && scrollPanelIntoView && allLogs.length > 0) {
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
  }, [allLogs, expanded, scrollPanelIntoView, runSessionCardRef]);

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

  const groupedLogs = groupPromptEntries(allLogs);

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
        {allLogs.length === 0 && !logsLoading && (
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

        {logsLoading && allLogs.length === 0 && (
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
