import {
  IconBriefcase,
  IconChevronRight,
  IconClock,
  IconCoin,
  IconDeviceDesktop,
  IconEar,
  IconEye,
  IconHandStop,
  IconHelp,
  IconHourglass,
  IconLink,
  IconList,
  IconLogout,
  IconMail,
  IconMessage,
  IconMessages,
  IconMicrophone,
  IconPlayerPause,
  IconRobot,
  IconSearch,
  IconServer,
  IconSettings,
  IconTerminal2,
  IconTextCaption,
  IconTool,
  IconUsers,
  IconWand,
  IconWorld,
} from "@tabler/icons-react";
import type { ComponentType, CSSProperties } from "react";

interface IconSpec {
  Icon: ComponentType<{ size?: number; color?: string; style?: CSSProperties }>;
  color: string;
}

// Icon + color per command prefix. Colors are Mantine CSS vars at shade .4–.5
// so they pop on both the dark bubble and the blue (own) bubble. Avoid blue/
// indigo for own-side legibility against the blue background.
const COMMAND_ICONS: Record<string, IconSpec> = {
  "ns-comment": {
    Icon: IconMessage,
    color: "var(--mantine-color-gray-4)",
  },
  "ns-look": {
    Icon: IconEye,
    color: "var(--mantine-color-yellow-4)",
  },
  "ns-listen": {
    Icon: IconEar,
    color: "var(--mantine-color-violet-4)",
  },
  "ns-genimg": {
    Icon: IconWand,
    color: "var(--mantine-color-pink-4)",
  },
  "ns-desktop": {
    Icon: IconDeviceDesktop,
    color: "var(--mantine-color-cyan-4)",
  },
  "ns-tool": {
    Icon: IconTool,
    color: "var(--mantine-color-grape-5)",
  },
  "ns-browser": {
    Icon: IconWorld,
    color: "var(--mantine-color-lime-4)",
  },
  "ns-websearch": {
    Icon: IconSearch,
    color: "var(--mantine-color-teal-4)",
  },
  "ns-lynx": {
    Icon: IconTextCaption,
    color: "var(--mantine-color-teal-5)",
  },
  "ns-mail": {
    Icon: IconMail,
    color: "var(--mantine-color-orange-4)",
  },
  "ns-chat": {
    Icon: IconMessages,
    color: "var(--mantine-color-green-4)",
  },
  "ns-session": {
    Icon: IconClock,
    color: "var(--mantine-color-gray-5)",
  },
  "ns-agent": {
    Icon: IconRobot,
    color: "var(--mantine-color-grape-4)",
  },
  "ns-users": {
    Icon: IconUsers,
    color: "var(--mantine-color-pink-5)",
  },
  "ns-pty": {
    Icon: IconTerminal2,
    color: "var(--mantine-color-gray-5)",
  },
  "ns-workspace": {
    Icon: IconBriefcase,
    color: "var(--mantine-color-yellow-5)",
  },
  "ns-config": {
    Icon: IconSettings,
    color: "var(--mantine-color-gray-4)",
  },
  "ns-cost": {
    Icon: IconCoin,
    color: "var(--mantine-color-yellow-5)",
  },
  "ns-context": {
    Icon: IconList,
    color: "var(--mantine-color-gray-4)",
  },
  "ns-host": {
    Icon: IconServer,
    color: "var(--mantine-color-gray-4)",
  },
  "ns-hub": {
    Icon: IconLink,
    color: "var(--mantine-color-lime-5)",
  },
  "ns-talk": {
    Icon: IconMicrophone,
    color: "var(--mantine-color-yellow-4)",
  },
  "ns-cmd": {
    Icon: IconChevronRight,
    color: "var(--mantine-color-gray-5)",
  },
  "ns-pause": {
    Icon: IconPlayerPause,
    color: "var(--mantine-color-orange-5)",
  },
  "ns-wait": {
    Icon: IconHourglass,
    color: "var(--mantine-color-orange-4)",
  },
  "ns-kill": {
    Icon: IconHandStop,
    color: "var(--mantine-color-red-5)",
  },
  "ns-help": {
    Icon: IconHelp,
    color: "var(--mantine-color-cyan-5)",
  },
  exit: {
    Icon: IconLogout,
    color: "var(--mantine-color-red-4)",
  },
};

const COMMAND_REGEX = /^(ns-[a-z]+|exit)\b/;

const FALLBACK: IconSpec = {
  Icon: IconTerminal2,
  color: "var(--mantine-color-gray-5)",
};

export interface ParsedCommand {
  Icon: ComponentType<{ size?: number; color?: string; style?: CSSProperties }>;
  color: string;
  remainder: string;
}

/** Return the icon + remainder for a command line. Lines starting with a
 * registered prefix get their specific icon and have the prefix stripped;
 * everything else falls back to the terminal icon with the full line. */
export function parseCommandIcon(line: string): ParsedCommand {
  const match = COMMAND_REGEX.exec(line);
  const spec = match && COMMAND_ICONS[match[1]];
  if (!match || !spec) {
    return { ...FALLBACK, remainder: line };
  }
  return {
    Icon: spec.Icon,
    color: spec.color,
    remainder: line.slice(match[0].length).trimStart(),
  };
}
