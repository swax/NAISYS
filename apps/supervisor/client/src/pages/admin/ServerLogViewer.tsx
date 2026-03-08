import {
  Badge,
  Box,
  Button,
  Group,
  Loader,
  ScrollArea,
  Stack,
  Tabs,
  Text,
  Title,
} from "@mantine/core";
import { formatFileSize } from "@naisys/common";
import { IconRefresh } from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";

import type { PinoLogEntry, ServerLogResponse } from "../../lib/apiClient";
import { api, apiEndpoints } from "../../lib/apiClient";

function pinoLevelDisplay(level: number): { label: string; color: string } {
  if (level >= 60) return { label: "FATAL", color: "red" };
  if (level >= 50) return { label: "ERROR", color: "red" };
  if (level >= 40) return { label: "WARN", color: "yellow" };
  if (level >= 30) return { label: "INFO", color: "blue" };
  if (level >= 20) return { label: "DEBUG", color: "gray" };
  return { label: "TRACE", color: "gray" };
}

const LOG_TABS = [
  { value: "supervisor", label: "Supervisor" },
  { value: "hub-server", label: "Hub Server" },
  { value: "hub-client", label: "Hub Client" },
] as const;

export const ServerLogViewer: React.FC = () => {
  const [logTab, setLogTab] = useState<string>("supervisor");
  const [logData, setLogData] = useState<ServerLogResponse | null>(null);
  const [logLoading, setLogLoading] = useState(false);

  const fetchLogs = useCallback(async (file: string) => {
    setLogLoading(true);
    try {
      const result = await api.get<ServerLogResponse>(
        apiEndpoints.adminLogs(file),
      );
      setLogData(result);
    } catch {
      setLogData(null);
    } finally {
      setLogLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchLogs(logTab);
  }, [logTab, fetchLogs]);

  return (
    <>
      <Title order={3} mt="xl">
        Server Logs
      </Title>
      <Tabs value={logTab} onChange={(v) => v && setLogTab(v)}>
        <Tabs.List>
          {LOG_TABS.map((tab) => (
            <Tabs.Tab key={tab.value} value={tab.value}>
              {tab.label}
            </Tabs.Tab>
          ))}
        </Tabs.List>
      </Tabs>

      <Group>
        <Button
          size="xs"
          variant="light"
          leftSection={<IconRefresh size={14} />}
          onClick={() => fetchLogs(logTab)}
          loading={logLoading}
        >
          Refresh
        </Button>
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
            {[...logData.entries].reverse().map((entry: PinoLogEntry, i: number) => {
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
