import { MultiSelect } from "@mantine/core";
import React from "react";

import { formatAgentLabel } from "../../lib/agentLabel";
import type { Agent } from "../../lib/api/apiClient";

interface RecipientMultiSelectProps {
  agents: Agent[];
  currentAgentId: number;
  value: string[];
  onChange: (value: string[]) => void;
  label?: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
}

export const RecipientMultiSelect: React.FC<RecipientMultiSelectProps> = ({
  agents,
  currentAgentId,
  value,
  onChange,
  label = "To",
  placeholder = "Select recipients",
  required,
  disabled,
}) => {
  const data = agents
    .filter((agent) => agent.id !== currentAgentId)
    .map((agent) => ({
      value: String(agent.id),
      label: formatAgentLabel(agent.name, agent.title),
    }));

  return (
    <MultiSelect
      label={label}
      placeholder={placeholder}
      data={data}
      value={value}
      onChange={onChange}
      required={required}
      disabled={disabled}
      searchable
    />
  );
};
