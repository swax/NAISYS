import { Collapse, Group, NavLink, Text, UnstyledButton } from "@mantine/core";
import { IconChevronDown, IconChevronRight } from "@tabler/icons-react";
import React, { useState } from "react";
import { Link } from "react-router-dom";

import type { Agent } from "../../types/agent";
import { AgentModelIcon } from "../badges/AgentModelIcon";

interface AgentCandidatesSectionProps {
  candidates: Agent[];
  header: string;
  /**
   * Per-row props. Return `to` to render the row as a router Link, or omit
   * it and rely on `onCandidateClick` for button-style behavior.
   */
  getCandidateProps: (agent: Agent) => {
    active: boolean;
    to?: string;
  };
  onCandidateClick?: (agent: Agent) => void;
}

export const AgentCandidatesSection: React.FC<AgentCandidatesSectionProps> = ({
  candidates,
  header,
  getCandidateProps,
  onCandidateClick,
}) => {
  const [expanded, setExpanded] = useState(false);

  if (candidates.length === 0) return null;

  return (
    <>
      <UnstyledButton
        onClick={() => setExpanded((v) => !v)}
        px="xs"
        pt="sm"
        pb={4}
        w="100%"
      >
        <Group gap={4} wrap="nowrap">
          {expanded ? (
            <IconChevronDown size={12} style={{ flexShrink: 0 }} />
          ) : (
            <IconChevronRight size={12} style={{ flexShrink: 0 }} />
          )}
          <Text size="xs" c="dimmed" fw={500} tt="uppercase">
            {header} ({candidates.length})
          </Text>
        </Group>
      </UnstyledButton>
      <Collapse in={expanded}>
        {candidates.map((candidate) => {
          const { active, to } = getCandidateProps(candidate);
          const label = (
            <Group gap={6} wrap="nowrap">
              <AgentModelIcon
                shellModel={candidate.shellModel}
                size={14}
                style={{ flexShrink: 0 }}
              />
              <Text size="sm" lineClamp={1}>
                {candidate.name} ({candidate.title})
              </Text>
            </Group>
          );
          const styles = {
            root: { borderBottom: "1px solid var(--mantine-color-dark-6)" },
          };
          const handleClick = () => onCandidateClick?.(candidate);

          if (to) {
            return (
              <NavLink
                key={`candidate-${candidate.id}`}
                active={active}
                component={Link}
                to={to}
                onClick={handleClick}
                label={label}
                styles={styles}
              />
            );
          }
          return (
            <NavLink
              key={`candidate-${candidate.id}`}
              active={active}
              onClick={handleClick}
              label={label}
              styles={styles}
            />
          );
        })}
      </Collapse>
    </>
  );
};
