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
  Tooltip,
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
  SecretField,
  ServerLogViewer,
} from "@naisys/common-browser";
import { IconInfoCircle } from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";

import { downloadExportConfig, rotateHubAccessKey } from "../../lib/apiAdmin";
import type { AdminInfoResponse } from "../../lib/apiClient";
import { api, API_BASE, apiEndpoints } from "../../lib/apiClient";
import { UpdateDialog } from "./UpdateDialog";

export const AdminPage: React.FC = () => {
  const [data, setData] = useState<AdminInfoResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);

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

  const handleExport = async () => {
    setExporting(true);
    try {
      await downloadExportConfig();
    } finally {
      setExporting(false);
    }
  };

  const handleRotateAccessKey = async () => {
    const confirmed = window.confirm(
      "This will generate a new hub access key and disconnect all clients. " +
        "All NAISYS instances will need their HUB_ACCESS_KEY environment " +
        "variable updated in their .env file before they can reconnect.",
    );
    if (!confirmed) return;

    setRotating(true);
    try {
      const result = await rotateHubAccessKey();
      if (result.success) {
        void fetchData();
      }
    } finally {
      setRotating(false);
    }
  };

  const canExport = data ? !!hasAction(data._actions, "export-config") : false;
  const canViewLogs = data ? !!hasAction(data._actions, "view-logs") : false;
  const canRotateKey = data
    ? !!hasAction(data._actions, "rotate-access-key")
    : false;
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
                  <Button
                    onClick={handleExport}
                    loading={exporting}
                  >
                    Export Config
                  </Button>
                )}
                {canCheckUpdates && (
                  <Button
                    variant="light"
                    onClick={() => setUpdateOpen(true)}
                  >
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
                    <Table.Td>{data.hubVersion ? formatVersion(data.hubVersion) : "—"}</Table.Td>
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
                  {data.hubAccessKey && (
                    <Table.Tr>
                      <Table.Td fw={600}>
                        <Group gap={4}>
                          Access Key
                          <Tooltip
                            label="Set as HUB_ACCESS_KEY when installing NAISYS on other machines to connect to this hub"
                            multiline
                            w={250}
                          >
                            <IconInfoCircle
                              size="1rem"
                              style={{ cursor: "pointer" }}
                            />
                          </Tooltip>
                        </Group>
                      </Table.Td>
                      <Table.Td>
                        <SecretField
                          value={data.hubAccessKey}
                          onRotate={
                            canRotateKey ? handleRotateAccessKey : undefined
                          }
                          rotating={rotating}
                        />
                      </Table.Td>
                    </Table.Tr>
                  )}
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
        onUpdate={fetchData}
        currentVersion={data?.supervisorVersion ?? ""}
      />
    </Container>
  );
};
