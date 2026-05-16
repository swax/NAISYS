import { ActionIcon, Stack, Text, Tooltip } from "@mantine/core";
import { DEFAULT_REALTIME_MODEL_ID } from "@naisys/common";
import { IconPhone, IconPhoneOff } from "@tabler/icons-react";
import React from "react";

import { useVoiceSession } from "../../contexts/VoiceSessionContext";
import type { VoiceMode } from "../../lib/api/apiClient";

/**
 * Phone button — start/hang-up entry point for a voice session. See
 * `VoiceMode` for what each mode unlocks. When the active session matches
 * this (from, target, mode) tuple the button flips to a hang-up affordance,
 * so a click on the start icon never silently drops the live call.
 */
interface VoiceMicButtonProps {
  fromUsername: string;
  fromTitle: string;
  targetUsername: string;
  targetTitle: string;
  mode: VoiceMode;
  /** When set, render disabled with this string as the tooltip.
   *  Visible-but-disabled is less confusing than silent disappearance. */
  disabledReason?: string;
}

/** Pre-call tooltip — experimental/cost warning + mode-specific copy. */
const StartCallTooltipBody: React.FC<{
  mode: VoiceMode;
  fromUsername: string;
  targetUsername: string;
}> = ({ mode, fromUsername, targetUsername }) => {
  const heading =
    mode === "chat"
      ? `Experimental — uses ${DEFAULT_REALTIME_MODEL_ID}, which is expensive to run.`
      : `Experimental — uses ${DEFAULT_REALTIME_MODEL_ID}, which is expensive to run; this mode burns more tokens than the chat call because it narrates the full run log.`;
  const lines =
    mode === "chat"
      ? [
          `You call as ${fromUsername}.`,
          `The voice agent can send chat messages to ${targetUsername} on your behalf and watch which commands ${targetUsername} is running.`,
        ]
      : [
          `You call as admin.`,
          `The voice agent can see ${targetUsername}'s full console output and run shell commands directly on your behalf.`,
        ];

  return (
    <Stack gap={6}>
      <Text size="xs" fw={600}>
        {heading}
      </Text>
      {lines.map((line) => (
        <Text size="xs" key={line}>
          {line}
        </Text>
      ))}
    </Stack>
  );
};

export const VoiceMicButton: React.FC<VoiceMicButtonProps> = ({
  fromUsername,
  fromTitle,
  targetUsername,
  targetTitle,
  mode,
  disabledReason,
}) => {
  const { session, startSession, hangUp } = useVoiceSession();

  const isActiveHere =
    !disabledReason &&
    session?.fromUsername === fromUsername &&
    session?.targetUsername === targetUsername &&
    session?.mode === mode;

  const tooltipLabel: React.ReactNode = disabledReason ? (
    disabledReason
  ) : isActiveHere ? (
    `Hang up voice session with ${targetUsername}`
  ) : (
    <StartCallTooltipBody
      mode={mode}
      fromUsername={fromUsername}
      targetUsername={targetUsername}
    />
  );

  // span wrap so the tooltip still hovers when the button is disabled
  // (a disabled <button> swallows pointer events).
  return (
    <Tooltip
      label={tooltipLabel}
      multiline
      w={320}
      withArrow
      position="top"
      events={{ hover: true, focus: true, touch: true }}
    >
      <span style={{ display: "inline-flex" }}>
        <ActionIcon
          variant={isActiveHere ? "filled" : "subtle"}
          color={isActiveHere ? "red" : "gray"}
          size="lg"
          disabled={!!disabledReason}
          onClick={
            disabledReason
              ? undefined
              : isActiveHere
                ? hangUp
                : () =>
                    void startSession({
                      fromUsername,
                      fromTitle,
                      targetUsername,
                      targetTitle,
                      mode,
                    })
          }
          aria-label={
            disabledReason
              ? "Voice session unavailable"
              : isActiveHere
                ? "Hang up voice session"
                : "Start voice session"
          }
        >
          {isActiveHere ? <IconPhoneOff size={18} /> : <IconPhone size={18} />}
        </ActionIcon>
      </span>
    </Tooltip>
  );
};
