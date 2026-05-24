import {
  Alert,
  Box,
  Divider,
  Group,
  Indicator,
  Tabs,
  Text,
  UnstyledButton,
} from "@mantine/core";
import {
  IconInfoCircle,
  IconMail,
  IconMessageCircle,
  IconSettings,
  IconTerminal2,
} from "@tabler/icons-react";
import React, { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { AgentModelIcon } from "../components/badges/AgentModelIcon";
import { ROUTER_BASENAME } from "../constants";
import { useAgentDataContext } from "../contexts/AgentDataContext";
import { getAgentDetail } from "../lib/api/apiAgents";

interface AgentNavHeaderProps {
  agentUsername?: string;
  onAgentNameClick?: () => void;
}

export const AgentNavHeader: React.FC<AgentNavHeaderProps> = ({
  agentUsername,
  onAgentNameClick,
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { agents, readStatus } = useAgentDataContext();
  const [links, setLinks] = useState<{ rel: string; href: string }[]>([]);
  const [linksLoaded, setLinksLoaded] = useState(false);

  // Fetch detail links when agent changes
  useEffect(() => {
    if (!agentUsername) {
      setLinks([]);
      setLinksLoaded(false);
      return;
    }
    setLinksLoaded(false);
    void getAgentDetail(agentUsername).then((data) => {
      setLinks(data._links);
      setLinksLoaded(true);
    });
  }, [agentUsername]);

  if (!agentUsername) {
    return null;
  }

  // Find the current agent
  const currentAgent = agents.find((agent) => agent.name === agentUsername);
  const agentName = currentAgent?.name;

  // Determine active tab from current location
  // Path: /agents/:username/runs → split("/")[3] = "runs"
  const pathParts = location.pathname.split("/");
  const currentSection = pathParts.length >= 4 ? pathParts[3] : "detail";

  // Check if mail/chat are enabled via detail _links
  const hasMailLink = links.some((link) => link.rel === "mail");
  const hasChatLink = links.some((link) => link.rel === "chat");

  // Show info message when viewing a disabled chat tab (only after links loaded)
  const disabledTabMessage =
    linksLoaded && currentSection === "chat" && !hasChatLink
      ? "Chat messages can be sent to this agent, but the agent isn't configured to use chat."
      : null;

  const hasUnreadMail =
    currentAgent && agentName && readStatus[agentName]
      ? currentAgent.latestMailId > readStatus[agentName].lastReadMailId
      : false;

  const getTabUrl = (section: string) => {
    if (section === "detail") {
      return `/agents/${agentUsername}`;
    }
    return `/agents/${agentUsername}/${section}`;
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
    <div
      style={{
        flex: 1,
        height: "100%",
        overflowX: "auto",
        overflowY: "hidden",
      }}
    >
      <Group gap={0} align="center" wrap="nowrap" style={{ height: "100%" }}>
        {/* Agent name (mobile only) */}
        <UnstyledButton
          onClick={onAgentNameClick}
          hiddenFrom="md"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--mantine-spacing-xs)",
            flexShrink: 0,
          }}
        >
          <AgentModelIcon
            shellModel={currentAgent?.shellModel}
            size="1.2rem"
            color="var(--mantine-color-dimmed)"
          />
          {agentUsername && (
            <Text size="sm" fw={600}>
              {agentUsername}
            </Text>
          )}
        </UnstyledButton>
        <Box hiddenFrom="md" px="xs" style={{ flexShrink: 0 }}>
          <Divider orientation="vertical" h={20} />
        </Box>

        <Tabs
          value={currentSection || "detail"}
          style={{ flex: 1, height: "100%" }}
          styles={{ tab: { height: "100%" } }}
        >
          <Tabs.List style={{ flexWrap: "nowrap", height: "100%" }}>
            <Tabs.Tab
              value="detail"
              leftSection={<IconInfoCircle size="1rem" />}
              component="a"
              // @ts-expect-error - Mantine Tabs.Tab doesn't properly type component prop with href
              href={getAbsoluteUrl("detail")}
              onClick={(e: React.MouseEvent) => handleTabClick(e, "detail")}
            >
              <Text visibleFrom="sm" span>
                Detail
              </Text>
            </Tabs.Tab>
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
                  <Text visibleFrom="sm" span>
                    Mail
                  </Text>
                </Tabs.Tab>
              </Indicator>
            )}
            <Tabs.Tab
              value="chat"
              leftSection={<IconMessageCircle size="1rem" />}
              component="a"
              // @ts-expect-error - Mantine Tabs.Tab doesn't properly type component prop with href
              href={getAbsoluteUrl("chat")}
              onClick={(e: React.MouseEvent) => handleTabClick(e, "chat")}
              style={!hasChatLink && linksLoaded ? { opacity: 0.4 } : undefined}
            >
              <Text visibleFrom="sm" span>
                Chat
              </Text>
            </Tabs.Tab>
            <Tabs.Tab
              value="runs"
              leftSection={<IconTerminal2 size="1rem" />}
              component="a"
              // @ts-expect-error - Mantine Tabs.Tab doesn't properly type component prop with href
              href={getAbsoluteUrl("runs")}
              onClick={(e: React.MouseEvent) => handleTabClick(e, "runs")}
            >
              <Text visibleFrom="sm" span>
                Runs
              </Text>
            </Tabs.Tab>
            <Tabs.Tab
              value="config"
              leftSection={<IconSettings size="1rem" />}
              component="a"
              // @ts-expect-error - Mantine Tabs.Tab doesn't properly type component prop with href
              href={getAbsoluteUrl("config")}
              onClick={(e: React.MouseEvent) => handleTabClick(e, "config")}
            >
              <Text visibleFrom="sm" span>
                Config
              </Text>
            </Tabs.Tab>
          </Tabs.List>
        </Tabs>
      </Group>
      {disabledTabMessage && (
        <Alert variant="light" color="yellow" py="xs" px="md">
          {disabledTabMessage}
        </Alert>
      )}
    </div>
  );
};
