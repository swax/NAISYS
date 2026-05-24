import {
  Badge,
  Button,
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
import { useQuery } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import { downloadExportConfig } from "../../lib/api/apiAdmin";
import type { AdminInfoResponse } from "../../lib/api/apiClient";
import { api, API_BASE, apiEndpoints } from "../../lib/api/apiClient";
import { UpdateDialog } from "./UpdateDialog";

export const AdminPage: React.FC = () => {
  const [exporting, setExporting] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);

  const { data, isLoading: loading, refetch } = useQuery({
    queryKey: ["admin-info"],
    queryFn: () => api.get<AdminInfoResponse>(apiEndpoints.admin),
  });

  const handleExport = async () => {
    setExporting(true);
    try {
      await downloadExportConfig();
    } finally {
      setExporting(false);
    }
  };

  const canExport = data ? !!hasAction(data._actions, "export-config") : false;
  const canViewLogs = data ? !!hasAction(data._actions, "view-logs") : false;
  const canViewAttachments = data
    ? !!hasAction(data._actions, "view-attachments")
    : false;
  const canCheckUpdates = data
    ? !!hasAction(data._actions, "check-updates")
    : false;

  const LOG_TABS = [
    { value: "supervisor", label: "Supervisor" },
    { value: "hub-server", label: "Hub Server" },
    { value: "hub-client", label: "Hub Client" },
  ];

  const fetchLogs = useCallback(
    async (file: string | undefined, minLevel: number | undefined) => {
      return api.get<ServerLogResponse>(
        apiEndpoints.adminLogs(file!, undefined, minLevel),
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
    (id: string) => `${API_BASE}${apiEndpoints.attachmentDownload(id)}`,
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
            <Stack>
              <Title order={4}>Supervisor</Title>
              <Table striped highlightOnHover>
                <Table.Tbody>
                  <Table.Tr>
                    <Table.Td fw={600}>Version</Table.Td>
                    <Table.Td>
                      <Group gap="xs">
                        <span>{formatVersion(data.supervisorVersion)}</span>
                        <VersionBadge version={data.supervisorVersion} />
                        {data.targetVersion && (
                          <Badge
                            size="sm"
                            variant="light"
                            style={{ cursor: "pointer" }}
                            onClick={() => setUpdateOpen(true)}
                            color={
                              versionsMatch(
                                data.supervisorVersion,
                                data.targetVersion,
                              )
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
                    <Table.Td fw={600}>DB Path</Table.Td>
                    <Table.Td>
                      {data.supervisorDbPath}
                      {data.supervisorDbSize != null &&
                        ` (${formatFileSize(data.supervisorDbSize)})`}
                    </Table.Td>
                  </Table.Tr>
                  <Table.Tr>
                    <Table.Td fw={600}>DB Version</Table.Td>
                    <Table.Td>{data.supervisorDbVersion}</Table.Td>
                  </Table.Tr>
                </Table.Tbody>
              </Table>

              <Group>
                {canExport && (
                  <Button onClick={handleExport} loading={exporting}>
                    Export Config
                  </Button>
                )}
                {canCheckUpdates && (
                  <Button variant="light" onClick={() => setUpdateOpen(true)}>
                    Check for Updates
                  </Button>
                )}
              </Group>

              <Title order={4} mt="md">
                Hub
              </Title>
              <Table striped highlightOnHover>
                <Table.Tbody>
                  <Table.Tr>
                    <Table.Td fw={600}>Connection</Table.Td>
                    <Table.Td>
                      <Badge
                        color={data.hubConnected ? "green" : "red"}
                        variant="filled"
                        size="sm"
                      >
                        {data.hubConnected ? "Connected" : "Disconnected"}
                      </Badge>
                    </Table.Td>
                  </Table.Tr>
                  <Table.Tr>
                    <Table.Td fw={600}>Version</Table.Td>
                    <Table.Td>
                      {data.hubVersion ? (
                        <Group gap="xs">
                          <span>{formatVersion(data.hubVersion)}</span>
                          <VersionBadge version={data.hubVersion} />
                        </Group>
                      ) : (
                        "—"
                      )}
                    </Table.Td>
                  </Table.Tr>
                  <Table.Tr>
                    <Table.Td fw={600}>DB Path</Table.Td>
                    <Table.Td>
                      {data.hubDbPath}
                      {data.hubDbSize != null &&
                        ` (${formatFileSize(data.hubDbSize)})`}
                    </Table.Td>
                  </Table.Tr>
                  <Table.Tr>
                    <Table.Td fw={600}>DB Version</Table.Td>
                    <Table.Td>{data.hubDbVersion}</Table.Td>
                  </Table.Tr>
                </Table.Tbody>
              </Table>
            </Stack>
          </Tabs.Panel>

          {canViewLogs && (
            <Tabs.Panel value="logs" pt="md">
              <ServerLogViewer fetchLogs={fetchLogs} logFiles={LOG_TABS} />
            </Tabs.Panel>
          )}

          {canViewAttachments && (
            <Tabs.Panel value="attachments" pt="md">
              <AttachmentList
                fetchAttachments={fetchAttachments}
                getDownloadUrl={getDownloadUrl}
                extraColumns={[
                  {
                    header: "Purpose",
                    render: (att) => (
                      <Badge size="sm" variant="light">
                        {att.purpose as string}
                      </Badge>
                    ),
                  },
                ]}
              />
            </Tabs.Panel>
          )}
        </Tabs>
      ) : null}

      <UpdateDialog
        opened={updateOpen}
        onClose={() => setUpdateOpen(false)}
        onUpdate={refetch}
        currentVersion={data?.supervisorVersion ?? ""}
      />
    </Container>
  );
};
