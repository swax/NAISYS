import {
  Alert,
  Button,
  Code,
  Group,
  Modal,
  Stack,
  Text,
} from "@mantine/core";
import {
  IconCircleCheck,
  IconExternalLink,
  IconGauge,
  IconKey,
  IconRefresh,
} from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";

import type {
  OpenAiCodexOAuthPollResponse,
  OpenAiCodexOAuthStartResponse,
  OpenAiCodexOAuthUsageResponse,
} from "../../lib/apiClient";
import {
  checkOpenAiCodexOAuthUsage,
  pollOpenAiCodexOAuth,
  startOpenAiCodexOAuth,
} from "../../lib/apiVariables";

interface OpenAiOAuthSetupDialogProps {
  opened: boolean;
  onClose: () => void;
  onComplete: () => void;
}

const formatDuration = (seconds: number) => {
  const totalMinutes = Math.max(1, Math.ceil(seconds / 60));
  if (totalMinutes < 60) {
    return `${totalMinutes}m`;
  }

  const totalHours = Math.ceil(totalMinutes / 60);
  if (totalHours < 48) {
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
  }

  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return hours ? `${days}d ${hours}h` : `${days}d`;
};

const formatResetTime = (
  window: NonNullable<OpenAiCodexOAuthUsageResponse["primaryWindow"]>,
) => {
  if (window.resetAfterSeconds !== undefined) {
    return `resets in ${formatDuration(window.resetAfterSeconds)}`;
  }
  if (window.resetAt !== undefined) {
    const secondsUntilReset = Math.ceil(
      (window.resetAt * 1000 - Date.now()) / 1000,
    );
    return secondsUntilReset > 0
      ? `resets in ${formatDuration(secondsUntilReset)}`
      : `resets at ${new Date(window.resetAt * 1000).toLocaleTimeString()}`;
  }
  return undefined;
};

const formatUsageWindow = (
  label: string,
  window: OpenAiCodexOAuthUsageResponse["primaryWindow"],
) => {
  if (!window) return undefined;
  const parts: string[] = [];
  if (window.usedPercent !== undefined) {
    parts.push(`${Math.round(window.usedPercent)}% used`);
  }
  const reset = formatResetTime(window);
  if (reset) {
    parts.push(reset);
  }
  return parts.length ? `${label}: ${parts.join(", ")}` : undefined;
};

export const OpenAiOAuthSetupDialog: React.FC<
  OpenAiOAuthSetupDialogProps
> = ({ opened, onClose, onComplete }) => {
  const [flow, setFlow] = useState<OpenAiCodexOAuthStartResponse | null>(null);
  const [pollResult, setPollResult] =
    useState<OpenAiCodexOAuthPollResponse | null>(null);
  const [usageResult, setUsageResult] =
    useState<OpenAiCodexOAuthUsageResponse | null>(null);
  const [starting, setStarting] = useState(false);
  const [polling, setPolling] = useState(false);
  const [checkingUsage, setCheckingUsage] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setFlow(null);
    setPollResult(null);
    setUsageResult(null);
    setStarting(false);
    setPolling(false);
    setCheckingUsage(false);
    setError(null);
  }, []);

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleStart = async () => {
    setStarting(true);
    setError(null);
    setPollResult(null);
    setUsageResult(null);
    try {
      const result = await startOpenAiCodexOAuth();
      setFlow(result);
      setPollResult({
        success: true,
        status: "pending",
        message: "Waiting for OpenAI authorization.",
      });
      window.open(result.verificationUrl, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to start OpenAI OAuth setup",
      );
    } finally {
      setStarting(false);
    }
  };

  const handleCheckUsage = async () => {
    setCheckingUsage(true);
    setError(null);
    try {
      setUsageResult(await checkOpenAiCodexOAuthUsage());
    } catch (err) {
      setUsageResult(null);
      setError(
        err instanceof Error
          ? err.message
          : "Failed to check OpenAI Codex usage",
      );
    } finally {
      setCheckingUsage(false);
    }
  };

  const handlePoll = useCallback(async () => {
    if (!flow || polling) return;
    setPolling(true);
    setError(null);
    try {
      const result = await pollOpenAiCodexOAuth(flow.flowId);
      setPollResult(result);
      if (result.status === "complete") {
        setFlow(null);
        onComplete();
      } else if (result.status === "expired") {
        setFlow(null);
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to check OpenAI OAuth setup",
      );
    } finally {
      setPolling(false);
    }
  }, [flow, onComplete, polling]);

  useEffect(() => {
    if (!opened || !flow || pollResult?.status !== "pending") return;
    const interval = window.setInterval(() => {
      void handlePoll();
    }, Math.max(flow.intervalMs, 2_000));
    return () => window.clearInterval(interval);
  }, [flow, handlePoll, opened, pollResult?.status]);

  const isComplete = pollResult?.status === "complete";
  const isExpired = pollResult?.status === "expired";
  const primaryUsage = formatUsageWindow(
    "Primary",
    usageResult?.primaryWindow,
  );
  const secondaryUsage = formatUsageWindow(
    "Secondary",
    usageResult?.secondaryWindow,
  );
  const usageColor = usageResult?.limitReached
    ? "red"
    : usageResult
      ? "green"
      : "blue";

  return (
    <Modal opened={opened} onClose={handleClose} title="OpenAI Codex OAuth">
      <Stack gap="md">
        <Text size="sm" c="dimmed">
          Use this setup to utilize your OpenAI Codex subscription with NAISYS.
          It stores OAuth access, refresh, and expiry values as sensitive
          variables for the built-in OpenAI Codex OAuth models.
        </Text>

        {error && (
          <Alert color="red" title="Setup failed">
            {error}
          </Alert>
        )}

        {isComplete && (
          <Alert color="green" icon={<IconCircleCheck size={18} />}>
            OpenAI Codex OAuth variables were saved.
          </Alert>
        )}

        {isExpired && (
          <Alert color="yellow" title="Code expired">
            Start a new setup flow to get a fresh device code.
          </Alert>
        )}

        {usageResult && (
          <Alert
            color={usageColor}
            icon={<IconGauge size={18} />}
            title={usageResult.limitReached ? "Usage limit reached" : "Usage"}
          >
            <Stack gap={4}>
              <Text size="sm">{usageResult.message}</Text>
              {primaryUsage && <Text size="xs">{primaryUsage}</Text>}
              {secondaryUsage && <Text size="xs">{secondaryUsage}</Text>}
              <Text size="xs" c="dimmed">
                Checked at {new Date(usageResult.checkedAt).toLocaleTimeString()}
                {usageResult.refreshed ? "; access token refreshed" : ""}
              </Text>
            </Stack>
          </Alert>
        )}

        {flow ? (
          <Stack gap="sm">
            <Text size="sm">
              Enter this code on the OpenAI authorization page:
            </Text>
            <Code
              fz="xl"
              fw={700}
              px="md"
              py="sm"
              style={{ alignSelf: "flex-start" }}
            >
              {flow.userCode}
            </Code>
            <Text size="xs" c="dimmed">
              Expires at {new Date(flow.expiresAt).toLocaleTimeString()}.
            </Text>
            <Group>
              <Button
                leftSection={<IconExternalLink size={16} />}
                onClick={() =>
                  window.open(
                    flow.verificationUrl,
                    "_blank",
                    "noopener,noreferrer",
                  )
                }
              >
                Open OpenAI
              </Button>
              <Button
                variant="light"
                leftSection={<IconRefresh size={16} />}
                onClick={() => void handlePoll()}
                loading={polling}
              >
                Check Status
              </Button>
            </Group>
            {pollResult?.status === "pending" && (
              <Text size="sm" c="dimmed">
                Waiting for authorization...
              </Text>
            )}
          </Stack>
        ) : (
          <Group justify="space-between" align="center">
            <Group>
              <Button
                leftSection={<IconKey size={16} />}
                onClick={handleStart}
                loading={starting}
              >
                Start OAuth Setup
              </Button>
              <Button
                variant="light"
                leftSection={<IconGauge size={16} />}
                onClick={() => void handleCheckUsage()}
                loading={checkingUsage}
              >
                Check Usage
              </Button>
            </Group>
            {(isComplete || isExpired) && (
              <Button variant="subtle" onClick={handleClose}>
                Close
              </Button>
            )}
          </Group>
        )}
      </Stack>
    </Modal>
  );
};
