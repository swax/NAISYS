import { Divider, Group, Text, UnstyledButton } from "@mantine/core";
import React from "react";
import { Link, useLocation } from "react-router-dom";

import { NAV_HEADER_ROW_HEIGHT } from "../constants";
import { useSession } from "../contexts/SessionContext";
import { navTabs } from "./navTabs";

interface AppNavbarProps {
  onClose: () => void;
  hasErp: boolean;
}

export const AppNavbar: React.FC<AppNavbarProps> = ({ onClose, hasErp }) => {
  const location = useLocation();
  const { hasPermission } = useSession();

  const visibleTabs = navTabs.filter(
    (tab) => !tab.permission || hasPermission(tab.permission),
  );

  return (
    <>
      <Group gap={6} px="sm" py={4} h={NAV_HEADER_ROW_HEIGHT}>
        <Text size="sm" fw={700}>
          Supervisor
        </Text>
        {hasErp && (
          <>
            <Text size="sm" c="dimmed">
              |
            </Text>
            <Text
              size="sm"
              c="dimmed"
              component="a"
              href="/erp/"
              style={{ textDecoration: "none" }}
            >
              ERP
            </Text>
          </>
        )}
      </Group>
      <Divider mb={4} />
      {visibleTabs.map((tab) => {
        const isActive = location.pathname.startsWith(tab.path);
        return (
          <UnstyledButton
            key={tab.path}
            component={Link}
            to={tab.path}
            onClick={onClose}
            p="sm"
            mb={4}
            style={(theme) => ({
              borderRadius: theme.radius.sm,
              backgroundColor: isActive
                ? "var(--mantine-color-dark-5)"
                : undefined,
            })}
          >
            <Text
              size="sm"
              fw={isActive ? 600 : 400}
              c={!isActive ? "dimmed" : undefined}
            >
              {tab.label}
            </Text>
          </UnstyledButton>
        );
      })}
    </>
  );
};
