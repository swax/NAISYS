import {
  Anchor,
  Badge,
  Button,
  Group,
  Loader,
  Modal,
  Radio,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { formatVersion } from "@naisys/common";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";

import { useHostDataContext } from "../../contexts/HostDataContext";
import type { NpmVersionsResponse } from "../../lib/apiClient";
import { api, apiEndpoints } from "../../lib/apiClient";

interface UpdateDialogProps {
  opened: boolean;
  onClose: () => void;
  onUpdate: () => void;
  currentVersion: string;
}

type VersionOption = "none" | "latest" | "beta" | "custom";

export const UpdateDialog: React.FC<UpdateDialogProps> = ({
  opened,
  onClose,
  onUpdate,
  currentVersion,
}) => {
  const { hosts } = useHostDataContext();
  const queryClient = useQueryClient();

  const [npmData, setNpmData] = useState<NpmVersionsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedOption, setSelectedOption] =
    useState<VersionOption>("latest");
  const [customVersion, setCustomVersion] = useState("");
  const [customValid, setCustomValid] = useState<boolean | null>(null);
  const [validating, setValidating] = useState(false);

  const [commitHash, setCommitHash] = useState("");

  const [saving, setSaving] = useState(false);

  const hasGitHosts = hosts.some((h) => h.version?.includes("/"));

  const fetchNpmVersions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.get<NpmVersionsResponse>(
        apiEndpoints.adminNpmVersions,
      );
      setNpmData(result);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to fetch npm versions",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (opened) {
      void fetchNpmVersions();
      setSelectedOption("latest");
      setCustomVersion("");
      setCustomValid(null);
      setCommitHash("");
    }
  }, [opened, fetchNpmVersions]);

  const validateCustomVersion = async () => {
    const version = customVersion.trim();
    if (!version) return;
    setValidating(true);
    try {
      const result = await api.get<NpmVersionsResponse>(
        apiEndpoints.adminNpmVersionsCheck(version),
      );
      setCustomValid(result.check?.exists ?? false);
    } catch {
      setCustomValid(false);
    } finally {
      setValidating(false);
    }
  };

  const getSelectedNpmVersion = (): string => {
    switch (selectedOption) {
      case "none":
        return "";
      case "latest":
        return npmData?.latest ?? "";
      case "beta":
        return npmData?.beta ?? "";
      case "custom":
        return customVersion.trim();
    }
  };

  const getTargetVersion = (): string => {
    const npmVersion = getSelectedNpmVersion();
    const hash = commitHash.trim();
    if (hash) return `${npmVersion}/${hash}`;
    return npmVersion;
  };

  const canApply = (): boolean => {
    if (saving) return false;
    const npmVersion = getSelectedNpmVersion();
    const hash = commitHash.trim();
    if (!npmVersion && !hash) return false;
    if (
      selectedOption === "custom" &&
      npmVersion &&
      customValid === null
    )
      return false;
    return true;
  };

  const handleApply = async () => {
    const version = getTargetVersion();
    if (!version) return;

    const npmVersion = getSelectedNpmVersion();
    if (selectedOption === "custom" && npmVersion && customValid === false) {
      const confirmed = window.confirm(
        `Version "${npmVersion}" was not found on npm. Set it as target anyway?`,
      );
      if (!confirmed) return;
    }

    setSaving(true);
    try {
      const result = await api.put<
        { version: string },
        { success: boolean; message: string }
      >(apiEndpoints.adminTargetVersion, { version });
      if (result.success) {
        setNpmData((prev) =>
          prev ? { ...prev, targetVersion: version } : prev,
        );
        onUpdate();
        void queryClient.invalidateQueries({ queryKey: ["host-data"] });
        notifications.show({
          title: "Target Version Set",
          message: `TARGET_VERSION set to ${version}`,
          color: "green",
        });
        onClose();
      } else {
        notifications.show({
          title: "Error",
          message: result.message,
          color: "red",
        });
      }
    } catch (err) {
      notifications.show({
        title: "Error",
        message: err instanceof Error ? err.message : "Unknown error",
        color: "red",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    setSaving(true);
    try {
      const result = await api.put<
        { version: string },
        { success: boolean; message: string }
      >(apiEndpoints.adminTargetVersion, { version: "" });
      if (result.success) {
        setNpmData((prev) =>
          prev ? { ...prev, targetVersion: "" } : prev,
        );
        onUpdate();
        void queryClient.invalidateQueries({ queryKey: ["host-data"] });
        notifications.show({
          title: "Target Cleared",
          message: "TARGET_VERSION cleared",
          color: "green",
        });
        onClose();
      }
    } catch (err) {
      notifications.show({
        title: "Error",
        message: err instanceof Error ? err.message : "Unknown error",
        color: "red",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Software Update"
      size="lg"
    >
      {loading ? (
        <Stack align="center" py="xl">
          <Loader />
        </Stack>
      ) : error ? (
        <Stack gap="md">
          <Text c="red">{error}</Text>
          <Button variant="light" onClick={fetchNpmVersions}>
            Retry
          </Button>
        </Stack>
      ) : npmData ? (
        <Stack gap="md">
          <Table striped highlightOnHover>
            <Table.Tbody>
              <Table.Tr>
                <Table.Td fw={600}>Installed Version</Table.Td>
                <Table.Td>{formatVersion(currentVersion)}</Table.Td>
              </Table.Tr>
              <Table.Tr>
                <Table.Td fw={600}>Latest Stable</Table.Td>
                <Table.Td>{npmData.latest}</Table.Td>
              </Table.Tr>
              {npmData.beta && (
                <Table.Tr>
                  <Table.Td fw={600}>Latest Beta</Table.Td>
                  <Table.Td>{npmData.beta}</Table.Td>
                </Table.Tr>
              )}
              <Table.Tr>
                <Table.Td fw={600}>Current Target</Table.Td>
                <Table.Td>
                  {npmData.targetVersion ? (
                    <Badge variant="light" color="blue">
                      {formatVersion(npmData.targetVersion)}
                    </Badge>
                  ) : (
                    <Text span c="dimmed" size="sm">
                      (not set)
                    </Text>
                  )}
                </Table.Td>
              </Table.Tr>
            </Table.Tbody>
          </Table>

          <Radio.Group
            value={selectedOption}
            onChange={(v) => setSelectedOption(v as VersionOption)}
            label={
              <Group gap="xs">
                <span>Set npm target version</span>
                <Anchor
                  href="https://www.npmjs.com/package/naisys?activeTab=versions"
                  target="_blank"
                  size="sm"
                >
                  (all versions)
                </Anchor>
              </Group>
            }
          >
            <Stack gap="xs" mt="xs">
              {hasGitHosts && <Radio value="none" label="None" />}
              <Radio
                value="latest"
                label={`Latest stable (${npmData.latest})`}
              />
              {npmData.beta && (
                <Radio value="beta" label={`Beta (${npmData.beta})`} />
              )}
              <Group gap="sm" align="center">
                <Radio value="custom" label="Custom" />
                {selectedOption === "custom" && (
                  <>
                    <TextInput
                      placeholder="e.g. 1.2.3"
                      value={customVersion}
                      onChange={(e) => {
                        setCustomVersion(e.currentTarget.value);
                        setCustomValid(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void validateCustomVersion();
                      }}
                      size="xs"
                      style={{ width: 140 }}
                    />
                    <Button
                      size="xs"
                      variant="light"
                      onClick={validateCustomVersion}
                      loading={validating}
                      disabled={!customVersion.trim()}
                    >
                      Verify
                    </Button>
                    {customValid === true && (
                      <Badge color="green" size="sm">
                        Found
                      </Badge>
                    )}
                    {customValid === false && (
                      <Badge color="red" size="sm">
                        Not found
                      </Badge>
                    )}
                  </>
                )}
              </Group>
            </Stack>
          </Radio.Group>

          {hasGitHosts && (
            <TextInput
              label="Git commit hash"
              description="Full commit hash for git-based hosts"
              placeholder="e.g. a1b2c3d4e5f6..."
              value={commitHash}
              onChange={(e) => setCommitHash(e.currentTarget.value)}
            />
          )}

          <Title order={5} mt="xs">
            Hosts
          </Title>
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Host</Table.Th>
                <Table.Th>Version</Table.Th>
                <Table.Th>Status</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {hosts.length === 0 ? (
                <Table.Tr>
                  <Table.Td colSpan={3}>
                    <Text c="dimmed" size="sm" ta="center">
                      No hosts
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ) : (
                hosts.map((host) => (
                  <Table.Tr key={host.id}>
                    <Table.Td>{host.name}</Table.Td>
                    <Table.Td>
                      {host.version ? formatVersion(host.version) : "\u2014"}
                    </Table.Td>
                    <Table.Td>
                      <Badge
                        size="sm"
                        variant="light"
                        color={host.online ? "green" : "gray"}
                      >
                        {host.online ? "online" : "offline"}
                      </Badge>
                    </Table.Td>
                  </Table.Tr>
                ))
              )}
            </Table.Tbody>
          </Table>

          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
            {npmData.targetVersion && (
              <Button
                variant="subtle"
                color="red"
                onClick={handleClear}
                loading={saving}
              >
                Clear Target
              </Button>
            )}
            <Button
              onClick={handleApply}
              loading={saving}
              disabled={!canApply()}
            >
              Set Target Version
            </Button>
          </Group>
        </Stack>
      ) : null}
    </Modal>
  );
};
