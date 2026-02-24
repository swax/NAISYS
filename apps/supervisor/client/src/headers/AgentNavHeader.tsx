import { Group, Indicator, Tabs, Text } from "@mantine/core";
import {
  IconHistory,
  IconInfoCircle,
  IconMail,
  IconMessageCircle,
  IconSettings,
} from "@tabler/icons-react";
import React, { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { ROUTER_BASENAME } from "../constants";
import { useAgentDataContext } from "../contexts/AgentDataContext";
import { getAgentDetail } from "../lib/apiAgents";

interface AgentNavHeaderProps {
  agentId?: number;
}

export const AgentNavHeader: React.FC<AgentNavHeaderProps> = ({ agentId }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { agents, readStatus } = useAgentDataContext();
  const [links, setLinks] = useState<{ rel: string; href: string }[]>([]);

  // Fetch detail links when agent changes
  useEffect(() => {
    if (!agentId) {
      setLinks([]);
      return;
    }
    void getAgentDetail(agentId).then((data) => {
      setLinks(data._links);
    });
  }, [agentId]);

  if (!agentId) {
    return null;
  }

  // Find the current agent
  const currentAgent = agents.find((agent) => agent.id === agentId);
  const agentName = currentAgent?.name;

  // Check if mail/chat are enabled via detail _links
  const hasMailLink = links.some((link) => link.rel === "mail");
  const hasChatLink = links.some((link) => link.rel === "chat");

  // Check for unread data
  const hasUnreadLogs =
    currentAgent && agentName && readStatus[agentName]
      ? currentAgent.latestLogId > readStatus[agentName].lastReadLogId
      : false;

  const hasUnreadMail =
    currentAgent && agentName && readStatus[agentName]
      ? currentAgent.latestMailId > readStatus[agentName].lastReadMailId
      : false;

  // Determine active tab from current location
  // Path: /agents/:id/runs → split("/")[3] = "runs"
  const pathParts = location.pathname.split("/");
  const currentSection = pathParts.length >= 4 ? pathParts[3] : "detail";

  const getTabUrl = (section: string) => {
    if (section === "detail") {
      return `/agents/${agentId}`;
    }
    return `/agents/${agentId}/${section}`;
  };

  const getAbsoluteUrl = (section: string) => {
    return `${ROUTER_BASENAME}${getTabUrl(section)}`;
  };

  const handleTabClick = (e: React.MouseEvent, section: string) => {
    // Allow default behavior for middle-click and ctrl/cmd+click
    if (e.button === 1 || e.ctrlKey || e.metaKey) {
      return;
    }

    // Prevent default for regular clicks and handle with navigate
    e.preventDefault();
    void navigate(getTabUrl(section));
  };

  return (
    <Group gap="md" align="center">
      <Tabs
        value={currentSection || "detail"}
        style={{ flex: 1, height: "100%" }}
      >
        <Tabs.List>
          <Tabs.Tab
            value="detail"
            leftSection={<IconInfoCircle size="1rem" />}
            component="a"
            // @ts-expect-error - Mantine Tabs.Tab doesn't properly type component prop with href
            href={getAbsoluteUrl("detail")}
            onClick={(e: React.MouseEvent) => handleTabClick(e, "detail")}
          >
            <Text visibleFrom="sm" span>Detail</Text>
          </Tabs.Tab>
          <Indicator
            disabled={!hasUnreadLogs}
            color="pink"
            size={8}
            offset={7}
            processing
          >
            <Tabs.Tab
              value="runs"
              leftSection={<IconHistory size="1rem" />}
              component="a"
              // @ts-expect-error - Mantine Tabs.Tab doesn't properly type component prop with href
              href={getAbsoluteUrl("runs")}
              onClick={(e: React.MouseEvent) => handleTabClick(e, "runs")}
            >
              <Text visibleFrom="sm" span>Runs</Text>
            </Tabs.Tab>
          </Indicator>
          {hasMailLink && (
            <Indicator
              disabled={!hasUnreadMail}
              color="blue"
              size={8}
              offset={7}
              processing
            >
              <Tabs.Tab
                value="mail"
                leftSection={<IconMail size="1rem" />}
                component="a"
                // @ts-expect-error - Mantine Tabs.Tab doesn't properly type component prop with href
                href={getAbsoluteUrl("mail")}
                onClick={(e: React.MouseEvent) => handleTabClick(e, "mail")}
              >
                <Text visibleFrom="sm" span>Mail</Text>
              </Tabs.Tab>
            </Indicator>
          )}
          {hasChatLink && (
            <Tabs.Tab
              value="chat"
              leftSection={<IconMessageCircle size="1rem" />}
              component="a"
              // @ts-expect-error - Mantine Tabs.Tab doesn't properly type component prop with href
              href={getAbsoluteUrl("chat")}
              onClick={(e: React.MouseEvent) => handleTabClick(e, "chat")}
            >
              <Text visibleFrom="sm" span>Chat</Text>
            </Tabs.Tab>
          )}
          <Tabs.Tab
            value="config"
            leftSection={<IconSettings size="1rem" />}
            component="a"
            // @ts-expect-error - Mantine Tabs.Tab doesn't properly type component prop with href
            href={getAbsoluteUrl("config")}
            onClick={(e: React.MouseEvent) => handleTabClick(e, "config")}
          >
            <Text visibleFrom="sm" span>Config</Text>
          </Tabs.Tab>
        </Tabs.List>
      </Tabs>
    </Group>
  );
};
