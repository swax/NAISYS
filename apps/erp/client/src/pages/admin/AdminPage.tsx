import {
  Badge,
  Container,
  Group,
  Loader,
  Stack,
  Table,
  Tabs,
  Title,
} from "@mantine/core";
import {
  formatFileSize,
  formatVersion,
  hasAction,
  versionsMatch,
} from "@naisys/common";
import type {
  AttachmentListData,
  ServerLogResponse,
} from "@naisys/common-browser";
import {
  AttachmentList,
  ServerLogViewer,
  VersionBadge,
} from "@naisys/common-browser";
import type { AdminInfoResponse } from "@naisys/erp-shared";
import { useCallback, useEffect, useState } from "react";

import { api, apiEndpoints } from "../../lib/api";

export const AdminPage: React.FC = () => {
  const [data, setData] = useState<AdminInfoResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.get<AdminInfoResponse>(apiEndpoints.admin);
      setData(result);
    } catch {
      // error handled silently
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const canViewLogs = data ? !!hasAction(data._actions, "view-logs") : false;
  const canViewAttachments = data
    ? !!hasAction(data._actions, "view-attachments")
    : false;

  const fetchLogs = useCallback(
    async (_file: string | undefined, minLevel: number | undefined) => {
      return api.get<ServerLogResponse>(
        apiEndpoints.adminLogs(undefined, minLevel),
      );
    },
    [],
  );

  const fetchAttachments = useCallback(
    async (page: number, pageSize: number) => {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("pageSize", String(pageSize));
      return api.get<AttachmentListData>(
        `${apiEndpoints.adminAttachments}?${params}`,
      );
    },
    [],
  );

  const getDownloadUrl = useCallback(
    (id: string) => apiEndpoints.adminAttachmentDownload(id),
    [],
  );

  return (
    <Container size="lg" py="xl" w="100%">
      <Title order={2} mb="lg">
        Admin
      </Title>

      {loading ? (
        <Stack align="center" py="xl">
          <Loader />
        </Stack>
      ) : data ? (
        <Tabs defaultValue="info">
          <Tabs.List>
            <Tabs.Tab value="info">Info</Tabs.Tab>
            {canViewLogs && <Tabs.Tab value="logs">Server Logs</Tabs.Tab>}
            {canViewAttachments && (
              <Tabs.Tab value="attachments">Attachments</Tabs.Tab>
            )}
          </Tabs.List>

          <Tabs.Panel value="info" pt="md">
            <Table striped highlightOnHover>
              <Table.Tbody>
                <Table.Tr>
                  <Table.Td fw={600}>ERP Version</Table.Td>
                  <Table.Td>
                    <Group gap="xs">
                      <span>{formatVersion(data.erpVersion)}</span>
                      <VersionBadge version={data.erpVersion} />
                      {data.targetVersion && (
                        <Badge
                          size="sm"
                          variant="light"
                          color={
                            versionsMatch(data.erpVersion, data.targetVersion)
                              ? "green"
                              : "red"
                          }
                        >
                          target: {formatVersion(data.targetVersion)}
                        </Badge>
                      )}
                    </Group>
                  </Table.Td>
                </Table.Tr>
                <Table.Tr>
                  <Table.Td fw={600}>ERP DB Path</Table.Td>
                  <Table.Td>
                    {data.erpDbPath}
                    {data.erpDbSize != null &&
                      ` (${formatFileSize(data.erpDbSize)})`}
                  </Table.Td>
                </Table.Tr>
                <Table.Tr>
                  <Table.Td fw={600}>ERP DB Version</Table.Td>
                  <Table.Td>{data.erpDbVersion}</Table.Td>
                </Table.Tr>
              </Table.Tbody>
            </Table>
          </Tabs.Panel>

          {canViewLogs && (
            <Tabs.Panel value="logs" pt="md">
              <ServerLogViewer fetchLogs={fetchLogs} />
            </Tabs.Panel>
          )}

          {canViewAttachments && (
            <Tabs.Panel value="attachments" pt="md">
              <AttachmentList
                fetchAttachments={fetchAttachments}
                getDownloadUrl={getDownloadUrl}
              />
            </Tabs.Panel>
          )}
        </Tabs>
      ) : null}
    </Container>
  );
};
