import {
  Anchor,
  Badge,
  Button,
  Checkbox,
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
import { formatVersion, hasAction, parseVersion } from "@naisys/common";
import { VersionBadge } from "@naisys/common-browser";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { useHostDataContext } from "../../contexts/HostDataContext";
import type { NpmVersionsResponse } from "../../lib/api/apiClient";
import { api, apiEndpoints } from "../../lib/api/apiClient";

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

  const {
    data: npmData,
    isLoading: loading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["npm-versions"],
    queryFn: () => api.get<NpmVersionsResponse>(apiEndpoints.adminNpmVersions),
    enabled: opened,
  });

  const [selectedOption, setSelectedOption] = useState<VersionOption>("latest");
  const [customVersion, setCustomVersion] = useState("");
  const [customValid, setCustomValid] = useState<boolean | null>(null);
  const [validating, setValidating] = useState(false);

  const [commitHash, setCommitHash] = useState("");
  const [allowNewer, setAllowNewer] = useState(true);

  const [saving, setSaving] = useState(false);

  // "Check for updates" must reflect current npm/target data on every open,
  // so evict the cached response on close — the next open is then a cold
  // fetch behind a loader, never a stale cache hit.
  useEffect(() => {
    if (!opened) {
      queryClient.removeQueries({ queryKey: ["npm-versions"] });
    }
  }, [opened, queryClient]);

  // Initialize the form from the loaded target version, once per dialog open.
  // A background refetch must not clobber edits in progress, so this is keyed
  // on `opened` rather than firing on every npmData change.
  const formInitialized = useRef(false);
  useEffect(() => {
    if (!opened) {
      formInitialized.current = false;
      return;
    }
    if (formInitialized.current || !npmData) return;
    formInitialized.current = true;

    setCustomVersion("");
    setCustomValid(null);
    setCommitHash("");
    setAllowNewer(true);

    if (npmData.targetVersion) {
      const {
        operator,
        npm: npmPart,
        hash: hashPart,
      } = parseVersion(npmData.targetVersion);

      if (hashPart) setCommitHash(hashPart);
      setAllowNewer(operator === ">=");

      if (!npmPart) {
        setSelectedOption("none");
      } else if (npmPart === npmData.latest) {
        setSelectedOption("latest");
      } else if (npmPart === npmData.beta) {
        setSelectedOption("beta");
      } else {
        setSelectedOption("custom");
        setCustomVersion(npmPart);
        setCustomValid(true);
      }
    } else {
      setSelectedOption("latest");
    }
  }, [opened, npmData]);

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
    const npmPart = allowNewer && npmVersion ? `>=${npmVersion}` : npmVersion;
    if (hash) return `${npmPart}/${hash}`;
    return npmPart;
  };

  const isValidFullHash = (hash: string) => /^[0-9a-f]{40}$/i.test(hash);

  const canApply = (): boolean => {
    if (saving) return false;
    const npmVersion = getSelectedNpmVersion();
    const hash = commitHash.trim();
    if (!npmVersion && !hash) return false;
    if (hash && !isValidFullHash(hash)) return false;
    if (selectedOption === "custom" && npmVersion && customValid === null)
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
        queryClient.setQueryData<NpmVersionsResponse>(
          ["npm-versions"],
          (prev) => (prev ? { ...prev, targetVersion: version } : prev),
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
      const result = await api.delete<{ success: boolean; message: string }>(
        apiEndpoints.adminTargetVersion,
      );
      if (result.success) {
        queryClient.setQueryData<NpmVersionsResponse>(
          ["npm-versions"],
          (prev) => (prev ? { ...prev, targetVersion: "" } : prev),
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

  const canSetTarget = !!hasAction(npmData?._actions, "set-target-version");
  const canClearTarget = !!hasAction(npmData?._actions, "clear-target-version");

  return (
    <Modal opened={opened} onClose={onClose} title="Software Update" size="lg">
      {loading ? (
        <Stack align="center" py="xl">
          <Loader />
        </Stack>
      ) : error ? (
        <Stack gap="md">
          <Text c="red">{error.message}</Text>
          <Button variant="light" onClick={() => void refetch()}>
            Retry
          </Button>
        </Stack>
      ) : npmData ? (
        <Stack gap="md">
          <Table striped highlightOnHover>
            <Table.Tbody>
              <Table.Tr>
                <Table.Td fw={600}>Installed Version</Table.Td>
                <Table.Td>
                  <Group gap="xs">
                    <span>{formatVersion(currentVersion)}</span>
                    <VersionBadge version={currentVersion} />
                  </Group>
                </Table.Td>
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
                <span>npm hosts — target version</span>
                <Anchor
                  href="https://www.npmjs.com/package/naisys?activeTab=versions"
                  target="_blank"
                  size="sm"
                >
                  (all versions)
                </Anchor>
              </Group>
            }
            description="Applied to hosts installed from the npm package"
          >
            <Stack gap="xs" mt="xs">
              <Radio value="none" label="None" />
              <Radio
                value="latest"
                label={`Latest stable (${npmData.latest})`}
              />
              {npmData.beta && (
                <Radio value="beta" label={`Beta (${npmData.beta})`} />
              )}
              <Group gap="sm" align="center">
                <Radio value="custom" label="Other" />
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

          <Checkbox
            label="Allow newer versions (don't downgrade hosts above this version)"
            checked={allowNewer}
            disabled={selectedOption === "none"}
            onChange={(e) => setAllowNewer(e.currentTarget.checked)}
          />

          <TextInput
            label="git hosts — commit hash"
            description="Applied to hosts installed from a git checkout. Full 40-character commit hash."
            placeholder="e.g. a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0"
            value={commitHash}
            onChange={(e) => setCommitHash(e.currentTarget.value)}
            error={
              commitHash.trim() && !isValidFullHash(commitHash.trim())
                ? "Must be a full 40-character hex hash"
                : undefined
            }
          />

          <Title order={5} mt="xs">
            Hosts
          </Title>
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Host</Table.Th>
                <Table.Th>Type</Table.Th>
                <Table.Th>Version</Table.Th>
                <Table.Th>Status</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {hosts.length === 0 ? (
                <Table.Tr>
                  <Table.Td colSpan={4}>
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
                      {host.version ? (
                        <VersionBadge version={host.version} />
                      ) : (
                        "\u2014"
                      )}
                    </Table.Td>
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
            {canClearTarget && (
              <Button
                variant="subtle"
                color="red"
                onClick={handleClear}
                loading={saving}
              >
                Clear Target
              </Button>
            )}
            {canSetTarget && (
              <Button
                onClick={handleApply}
                loading={saving}
                disabled={!canApply()}
              >
                Set Target Version
              </Button>
            )}
          </Group>
        </Stack>
      ) : null}
    </Modal>
  );
};
