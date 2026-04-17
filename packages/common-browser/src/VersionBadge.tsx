import type { BadgeProps } from "@mantine/core";
import { Badge } from "@mantine/core";
import React from "react";

interface VersionBadgeProps {
  version: string | null | undefined;
  size?: BadgeProps["size"];
}

export const VersionBadge: React.FC<VersionBadgeProps> = ({
  version,
  size = "sm",
}) => {
  if (!version) return null;
  const isGit = version.includes("/");
  return (
    <Badge size={size} variant="light" color={isGit ? "grape" : "cyan"}>
      {isGit ? "git" : "npm"}
    </Badge>
  );
};
