import { ActionIcon, Anchor, Badge, Group, Paper, Stack, Text } from "@mantine/core";
import {
  IconHeadphones,
  IconMessage,
  IconMicrophone,
  IconMicrophoneOff,
  IconPhoneOff,
  IconTerminal,
} from "@tabler/icons-react";
import React from "react";
import { Link } from "react-router-dom";

import { useVoiceSession } from "../../contexts/VoiceSessionContext";

/**
 * Persistent lower-right control for the active voice session. Mounted at the
 * app root so it survives route changes. Renders nothing when there is no
 * active session. See docs/019-voice-agent.md.
 */
export const FloatingVoiceControl: React.FC = () => {
  const { session, hangUp, toggleMute } = useVoiceSession();

  if (!session) return null;

  const {
    status,
    fromUsername,
    fromTitle,
    targetUsername,
    targetTitle,
    muted,
    totalCost,
    error,
  } = session;

  const costLabel = `$${totalCost.toFixed(2)}`;

  const statusBadge =
    status === "live" ? (
      <Badge color="green" variant="filled" size="sm">
        Live
      </Badge>
    ) : status === "connecting" ? (
      <Badge color="yellow" variant="light" size="sm">
        Connecting…
      </Badge>
    ) : (
      <Badge color="red" variant="filled" size="sm">
        Error
      </Badge>
    );

  return (
    <Paper
      shadow="md"
      p="sm"
      radius="md"
      withBorder
      style={{
        position: "fixed",
        bottom: 16,
        right: 16,
        zIndex: 100,
        width: 280,
      }}
    >
      <Stack gap="xs">
        <Group justify="space-between" wrap="nowrap" gap="xs">
          <Group gap={6} wrap="nowrap">
            <IconHeadphones size={18} />
            {statusBadge}
          </Group>
          <Group gap="xs" wrap="nowrap">
            <ActionIcon
              color={muted ? "red" : "gray"}
              variant={muted ? "filled" : "light"}
              size="md"
              onClick={toggleMute}
              disabled={status !== "live"}
              title={muted ? "Unmute" : "Mute"}
              aria-label={muted ? "Unmute microphone" : "Mute microphone"}
            >
              {muted ? (
                <IconMicrophoneOff size={16} />
              ) : (
                <IconMicrophone size={16} />
              )}
            </ActionIcon>
            <ActionIcon
              color="red"
              variant="filled"
              size="md"
              onClick={hangUp}
              title="Hang up"
              aria-label="Hang up voice session"
            >
              <IconPhoneOff size={16} />
            </ActionIcon>
          </Group>
        </Group>

        <Text size="sm">
          You are{" "}
          <Text span fw={700} title={fromTitle}>
            {fromUsername}
          </Text>{" "}
          talking to{" "}
          <Text span fw={700} title={targetTitle}>
            {targetUsername}
          </Text>
        </Text>

        {status === "error" && error && (
          <Text size="xs" c="red">
            {error}
          </Text>
        )}

        <Group justify="space-between" gap="xs" wrap="nowrap">
          <Group gap="md" wrap="nowrap">
            <Anchor
              component={Link}
              to={`/agents/${fromUsername}/chat/${targetUsername}`}
              size="xs"
            >
              <Group gap={4} wrap="nowrap">
                <IconMessage size={14} />
                Chat
              </Group>
            </Anchor>
            <Anchor
              component={Link}
              to={`/agents/${targetUsername}/runs`}
              size="xs"
            >
              <Group gap={4} wrap="nowrap">
                <IconTerminal size={14} />
                Run log
              </Group>
            </Anchor>
          </Group>
          <Text size="xs" fw={600} ff="monospace" c="dimmed">
            {costLabel}
          </Text>
        </Group>
      </Stack>
    </Paper>
  );
};
