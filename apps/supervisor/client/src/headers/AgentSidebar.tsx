import { ActionIcon, Badge, Card, Group, Stack, Text } from "@mantine/core";
import {
  IconFileText,
  IconMail,
  IconPlus,
  IconRobot,
} from "@tabler/icons-react";
import React, { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AddAgentDialog } from "../components/AddAgentDialog";
import { ROUTER_BASENAME } from "../constants";
import { useAgentDataContext } from "../contexts/AgentDataContext";
import { useSession } from "../contexts/SessionContext";
import { Agent } from "../types/agent";

export const AgentSidebar: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { agents, isLoading, readStatus } = useAgentDataContext();
  const { isAuthenticated } = useSession();
  const [modalOpened, setModalOpened] = useState(false);

  const isAgentSelected = (agentName: string) => {
    const pathParts = location.pathname.split("/");
    if (agentName === "all") {
      return !pathParts[2];
    }
    return pathParts[2] === agentName;
  };

  const getCurrentSection = () => location.pathname.split("/")[1];

  const getAgentUrl = (agent: Agent) => {
    const currentSection = getCurrentSection();

    const agentNameSuffix = agent.name === "all" ? "" : `/${agent.name}`;

    if (
      currentSection &&
      ["runs", "mail", "controls"].includes(currentSection)
    ) {
      return `/${currentSection}${agentNameSuffix}`;
    } else {
      return `/controls${agentNameSuffix}`;
    }
  };

  const getAbsoluteUrl = (agent: Agent) => {
    // For actual href attributes, we need the full path including basename
    return `${ROUTER_BASENAME}${getAgentUrl(agent)}`;
  };

  const handleAgentClick = (e: React.MouseEvent, agent: Agent) => {
    // Allow default behavior for middle-click and ctrl/cmd+click
    if (e.button === 1 || e.ctrlKey || e.metaKey) {
      return;
    }

    // Prevent default for regular clicks and handle with navigate
    e.preventDefault();
    navigate(getAgentUrl(agent));
  };

  if (isLoading) {
    return (
      <>
        <Group justify="space-between" mb="md">
          <Text size="sm" fw={600} c="dimmed">
            AGENTS
          </Text>
          <ActionIcon
            variant="subtle"
            color="gray"
            size="sm"
            onClick={() => setModalOpened(true)}
            disabled={!isAuthenticated}
          >
            <IconPlus size="1rem" />
          </ActionIcon>
        </Group>
        <Text size="sm" c="dimmed">
          Loading agents...
        </Text>
      </>
    );
  }

  type AgentWithDepth = Agent & { depth: number };

  const organizeAgentsHierarchically = (agents: Agent[]): AgentWithDepth[] => {
    const agentsByName = new Map(agents.map((agent) => [agent.name, agent]));
    const childrenMap = new Map<string, Agent[]>();
    const rootAgents: Agent[] = [];

    agents.forEach((agent) => {
      const leadName = agent.leadUsername;
      if (leadName && agentsByName.has(leadName)) {
        const children = childrenMap.get(leadName) ?? [];
        children.push(agent);
        childrenMap.set(leadName, children);
      } else {
        rootAgents.push(agent);
      }
    });

    const sortByName = (a: Agent, b: Agent) => a.name.localeCompare(b.name);

    rootAgents.sort(sortByName);
    childrenMap.forEach((childList) => childList.sort(sortByName));

    const organizedAgents: AgentWithDepth[] = [];
    const visiting = new Set<string>();
    const visited = new Set<string>();

    const traverse = (agent: Agent, depth: number) => {
      if (visiting.has(agent.name) || visited.has(agent.name)) {
        return;
      }

      visiting.add(agent.name);
      organizedAgents.push({ ...agent, depth });
      visited.add(agent.name);

      const children = childrenMap.get(agent.name) ?? [];
      children.forEach((child) => traverse(child, depth + 1));

      visiting.delete(agent.name);
    };

    rootAgents.forEach((agent) => traverse(agent, 0));

    agents
      .filter((agent) => !visited.has(agent.name))
      .sort(sortByName)
      .forEach((agent) => traverse(agent, 0));

    return organizedAgents;
  };

  const getUnreadLogBadge = (agent: Agent) => {
    const agentReadStatus = readStatus[agent.name];

    const showBadge =
      agentReadStatus && agent.latestLogId > agentReadStatus.lastReadLogId;

    if (!showBadge) {
      return null;
    }

    const handleLogClick = (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const agentNameSuffix = agent.name === "all" ? "" : `/${agent.name}`;
      navigate(`/runs${agentNameSuffix}?expand=new`);
    };

    return (
      <Badge
        size="xs"
        variant="light"
        color="pink"
        p={0}
        pl={1}
        pt={3}
        w={20}
        h={20}
        onClick={handleLogClick}
        style={{ cursor: "pointer" }}
      >
        <IconFileText size="0.8rem" />
      </Badge>
    );
  };

  const getUnreadMailBadge = (agent: Agent) => {
    const agentReadStatus = readStatus[agent.name];
    if (
      !agentReadStatus ||
      agent.latestMailId <= agentReadStatus.lastReadMailId
    ) {
      return null;
    }

    const handleMailClick = (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const agentNameSuffix = agent.name === "all" ? "" : `/${agent.name}`;
      navigate(`/mail${agentNameSuffix}`);
    };

    return (
      <Badge
        size="xs"
        variant="light"
        color="blue"
        p={0}
        pl={0}
        pt={3}
        w={20}
        h={20}
        onClick={handleMailClick}
        style={{ cursor: "pointer" }}
      >
        <IconMail size="0.8rem" />
      </Badge>
    );
  };

  const orderedAgents = organizeAgentsHierarchically(agents);

  return (
    <>
      <Group justify="space-between" mb="md">
        <Text size="sm" fw={600} c="dimmed">
          AGENTS
        </Text>
        <ActionIcon
          variant="subtle"
          color="gray"
          size="sm"
          onClick={() => setModalOpened(true)}
          disabled={!isAuthenticated}
        >
          <IconPlus size="1rem" />
        </ActionIcon>
      </Group>
      <Stack gap="xs">
        {orderedAgents.map((agent) => (
          <Card
            key={agent.name}
            padding="sm"
            radius="md"
            withBorder
            component="a"
            href={getAbsoluteUrl(agent)}
            onClick={(e) => handleAgentClick(e, agent)}
            style={{
              cursor: "pointer",
              backgroundColor: isAgentSelected(agent.name)
                ? "var(--mantine-color-blue-9)"
                : undefined,
              opacity: agent.name === "All" ? 1 : agent.online ? 1 : 0.5,
              marginLeft: agent.depth ? `${agent.depth * 1.5}rem` : undefined,
              textDecoration: "none",
              color: "inherit",
              display: "block",
            }}
          >
            <Group justify="space-between" align="center" wrap="nowrap">
              <div style={{ minWidth: 0, flex: 1 }}>
                <Group gap="xs" align="center" wrap="nowrap">
                  <IconRobot size="1rem" style={{ flexShrink: 0 }} />
                  <Text size="sm" fw={500} truncate="end">
                    {agent.name}
                  </Text>
                  {getUnreadLogBadge(agent)}
                  {getUnreadMailBadge(agent)}
                </Group>
                <Text size="xs" c="dimmed" truncate="end">
                  {agent.title}
                </Text>
              </div>
              {agent.name !== "All" && (
                <Badge
                  size="xs"
                  variant="light"
                  color={agent.online ? "green" : "gray"}
                  style={{
                    flexShrink: 0,
                    cursor: agent.online ? "pointer" : "default",
                  }}
                  onClick={(e) => {
                    if (agent.online) {
                      e.preventDefault();
                      e.stopPropagation();
                      const agentNameSuffix =
                        agent.name === "all" ? "" : `/${agent.name}`;
                      navigate(`/runs${agentNameSuffix}?expand=online`);
                    }
                  }}
                >
                  {agent.online ? "online" : "offline"}
                </Badge>
              )}
            </Group>
          </Card>
        ))}
      </Stack>

      <AddAgentDialog
        opened={modalOpened}
        onClose={() => setModalOpened(false)}
      />
    </>
  );
};
