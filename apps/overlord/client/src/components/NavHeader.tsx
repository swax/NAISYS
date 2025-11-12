import { Group, Tabs } from "@mantine/core";
import {
  IconDeviceGamepad2,
  IconHistory,
  IconMail,
} from "@tabler/icons-react";
import React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ROUTER_BASENAME } from "../constants";

interface NavHeaderProps {
  agentName?: string;
  sidebarWidth: number;
  sidebarCollapsed: boolean;
}

export const NavHeader: React.FC<NavHeaderProps> = ({
  agentName,
  sidebarWidth,
  sidebarCollapsed
}) => {
  const navigate = useNavigate();
  const location = useLocation();

  if (!agentName) {
    return null;
  }

  // Determine active tab from current location
  const currentSection = location.pathname.split("/")[1];

  const getTabUrl = (section: string) => {
    return `/${section}/${agentName}`;
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
    navigate(getTabUrl(section));
  };

  return (
    <Group
      gap="md"
      align="center"
      style={{
        position: 'fixed',
        top: '10px',
        left: sidebarCollapsed ? "100px" : `${sidebarWidth}px`
      }}
    >
      <Tabs
        value={currentSection}
        style={{ flex: 1, height: "100%" }}
      >
        <Tabs.List>
          <Tabs.Tab
            value="runs"
            leftSection={<IconHistory size="1rem" />}
            component="a"
            // @ts-expect-error - Mantine Tabs.Tab doesn't properly type component prop with href
            href={getAbsoluteUrl("runs")}
            onClick={(e: React.MouseEvent) => handleTabClick(e, "runs")}
          >
            Runs
          </Tabs.Tab>
          <Tabs.Tab
            value="mail"
            leftSection={<IconMail size="1rem" />}
            component="a"
            // @ts-expect-error - Mantine Tabs.Tab doesn't properly type component prop with href
            href={getAbsoluteUrl("mail")}
            onClick={(e: React.MouseEvent) => handleTabClick(e, "mail")}
          >
            Mail
          </Tabs.Tab>
          <Tabs.Tab
            value="controls"
            leftSection={<IconDeviceGamepad2 size="1rem" />}
            component="a"
            // @ts-expect-error - Mantine Tabs.Tab doesn't properly type component prop with href
            href={getAbsoluteUrl("controls")}
            onClick={(e: React.MouseEvent) => handleTabClick(e, "controls")}
          >
            Controls
          </Tabs.Tab>
        </Tabs.List>
      </Tabs>
    </Group>
  );
};
