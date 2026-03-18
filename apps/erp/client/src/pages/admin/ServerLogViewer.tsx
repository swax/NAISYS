import {
  Badge,
  Box,
  Button,
  Group,
  Loader,
  ScrollArea,
  SegmentedControl,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { formatFileSize } from "@naisys/common";
import type { PinoLogEntry, ServerLogResponse } from "@naisys-erp/shared";
import { IconRefresh } from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";

import { api, apiEndpoints } from "../../lib/api";

function pinoLevelDisplay(level: number): { label: string; color: string } {
  if (level >= 60) return { label: "FATAL", color: "red" };
  if (level >= 50) return { label: "ERROR", color: "red" };
  if (level >= 40) return { label: "WARN", color: "yellow" };
  if (level >= 30) return { label: "INFO", color: "blue" };
  if (level >= 20) return { label: "DEBUG", color: "gray" };
  return { label: "TRACE", color: "gray" };
}

export const ServerLogViewer: React.FC = () => {
  const [logData, setLogData] = useState<ServerLogResponse | null>(null);
  const [logLoading, setLogLoading] = useState(false);
  const [levelFilter, setLevelFilter] = useState<string>("all");

  const fetchLogs = useCallback(async (filter: string) => {
    setLogLoading(true);
    try {
      const minLevel = filter === "errors" ? 50 : undefined;
      const result = await api.get<ServerLogResponse>(
        apiEndpoints.adminLogs(undefined, minLevel),
      );
      setLogData(result);
    } catch {
      setLogData(null);
    } finally {
      setLogLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchLogs(levelFilter);
  }, [levelFilter, fetchLogs]);

  return (
    <>
      <Title order={3} mt="xl">
        Server Logs
      </Title>

      <Group>
        <Button
          size="xs"
          variant="light"
          leftSection={<IconRefresh size={14} />}
          onClick={() => fetchLogs(levelFilter)}
          loading={logLoading}
        >
          Refresh
        </Button>
        <SegmentedControl
          size="xs"
          value={levelFilter}
          onChange={setLevelFilter}
          data={[
            { value: "all", label: "All" },
            { value: "errors", label: "Errors" },
          ]}
        />
        {logData?.fileSize != null && (
          <Text size="sm" c="dimmed">
            File size: {formatFileSize(logData.fileSize)}
          </Text>
        )}
      </Group>

      {logLoading && !logData ? (
        <Stack align="center" py="md">
          <Loader size="sm" />
        </Stack>
      ) : logData && logData.entries.length > 0 ? (
        <ScrollArea h={600}>
          <Box
            style={{
              backgroundColor: "#1a1a1a",
              borderRadius: 4,
              padding: 12,
              fontFamily: "monospace",
              fontSize: 13,
            }}
          >
            {[...logData.entries]
              .reverse()
              .map((entry: PinoLogEntry, i: number) => {
                const { label, color } = pinoLevelDisplay(entry.level);
                return (
                  <Group
                    key={i}
                    gap="xs"
                    wrap="nowrap"
                    align="flex-start"
                    style={{ lineHeight: 1.6 }}
                  >
                    <Text
                      size="xs"
                      c="dimmed"
                      style={{
                        fontFamily: "monospace",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {new Date(entry.time).toLocaleString()}
                    </Text>
                    <Badge
                      size="xs"
                      color={color}
                      variant="filled"
                      style={{ flexShrink: 0 }}
                    >
                      {label}
                    </Badge>
                    <Text
                      size="xs"
                      c="gray.3"
                      style={{
                        fontFamily: "monospace",
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-all",
                      }}
                    >
                      {entry.msg}
                      {entry.detail && (
                        <span style={{ color: "var(--mantine-color-dimmed)" }}>
                          {" "}
                          {entry.detail}
                        </span>
                      )}
                    </Text>
                  </Group>
                );
              })}
          </Box>
        </ScrollArea>
      ) : (
        <Text c="dimmed" ta="center" py="md">
          No log entries found
        </Text>
      )}
    </>
  );
};
