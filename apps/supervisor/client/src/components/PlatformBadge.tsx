import type { BadgeProps } from "@mantine/core";
import { Badge } from "@mantine/core";
import React from "react";

const PLATFORM_META: Record<string, { label: string; color: string }> = {
  macos: { label: "macOS", color: "gray" },
  linux: { label: "Linux", color: "orange" },
  windows: { label: "Windows", color: "blue" },
  wsl: { label: "WSL", color: "teal" },
};

export const getPlatformBadge = (platform: string | undefined | null) =>
  PLATFORM_META[platform ?? ""] ?? { label: platform || "?", color: "gray" };

interface PlatformBadgeProps {
  platform: string | undefined | null;
  size?: BadgeProps["size"];
  variant?: BadgeProps["variant"];
}

export const PlatformBadge: React.FC<PlatformBadgeProps> = ({
  platform,
  size = "xs",
  variant = "light",
}) => {
  if (!platform) return null;
  const meta = getPlatformBadge(platform);
  return (
    <Badge size={size} variant={variant} color={meta.color}>
      {meta.label}
    </Badge>
  );
};
