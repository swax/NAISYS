import type { BadgeProps } from "@mantine/core";
import { Badge } from "@mantine/core";
import { LlmApiType } from "@naisys/common";
import React from "react";

const API_TYPE_META: Record<string, { label: string; color: string }> = {
  [LlmApiType.OpenAI]: { label: "OpenAI", color: "green" },
  [LlmApiType.OpenAICompatible]: { label: "OpenAI Compatible", color: "violet" },
  [LlmApiType.OpenAIOAuth]: { label: "OpenAI OAuth", color: "lime" },
  [LlmApiType.Anthropic]: { label: "Anthropic", color: "orange" },
  [LlmApiType.Google]: { label: "Google", color: "blue" },
  [LlmApiType.Mock]: { label: "Mock", color: "gray" },
  [LlmApiType.None]: { label: "None", color: "gray" },
};

export const getApiTypeBadge = (apiType: string | undefined | null) =>
  API_TYPE_META[apiType ?? ""] ?? { label: apiType || "?", color: "gray" };

export const getApiTypeBadgeColor = (apiType: string | undefined | null) =>
  getApiTypeBadge(apiType).color;

interface ApiTypeBadgeProps {
  apiType: string | undefined | null;
  size?: BadgeProps["size"];
  variant?: BadgeProps["variant"];
}

export const ApiTypeBadge: React.FC<ApiTypeBadgeProps> = ({
  apiType,
  size = "xs",
  variant = "light",
}) => {
  if (!apiType) return null;
  const meta = getApiTypeBadge(apiType);
  return (
    <Badge size={size} variant={variant} color={meta.color}>
      {meta.label}
    </Badge>
  );
};
