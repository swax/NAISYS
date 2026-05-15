import { ActionIcon } from "@mantine/core";
import { IconPhone, IconPhoneOff } from "@tabler/icons-react";
import React from "react";

import { useVoiceSession } from "../contexts/VoiceSessionContext";

/**
 * Phone button on the chat input row — start/hang-up entry point for a voice
 * session. Seeds X (the page's `{agent}`) and Y (the conversation partner).
 * Only mounted where the operator can already send chat, so no permission
 * check here. When the active session matches this conversation, the button
 * flips to a hang-up affordance — a click on the start icon should never
 * silently drop the live call.
 */
interface VoiceMicButtonProps {
  fromUsername: string;
  fromTitle: string;
  targetUsername: string;
  targetTitle: string;
  /** When set, render disabled with this string as the tooltip.
   *  Visible-but-disabled is less confusing than silent disappearance. */
  disabledReason?: string;
}

export const VoiceMicButton: React.FC<VoiceMicButtonProps> = ({
  fromUsername,
  fromTitle,
  targetUsername,
  targetTitle,
  disabledReason,
}) => {
  const { session, startSession, hangUp } = useVoiceSession();

  const isActiveHere =
    !disabledReason &&
    session?.fromUsername === fromUsername &&
    session?.targetUsername === targetUsername;

  return (
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
                })
      }
      title={
        disabledReason ??
        (isActiveHere
          ? `Hang up voice session with ${targetUsername}`
          : `Start a voice session to operate ${targetUsername}`)
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
  );
};
