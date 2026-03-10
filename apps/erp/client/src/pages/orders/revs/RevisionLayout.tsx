import {
  ActionIcon,
  Box,
  Drawer,
  Group,
  Loader,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import type { OrderRevision } from "@naisys-erp/shared";
import {
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconListDetails,
} from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";
import { Outlet, useLocation, useParams } from "react-router";

import { OperationSidebar } from "./OperationSidebar";
import { RevisionHeader } from "./RevisionHeader";
import { api, showErrorNotification } from "../../../lib/api";

const SIDEBAR_WIDTH = 260;

export const RevisionLayout: React.FC = () => {
  const { orderKey, revNo } = useParams<{
    orderKey: string;
    revNo: string;
  }>();
  const location = useLocation();
  const [item, setItem] = useState<OrderRevision | null>(null);
  const [loading, setLoading] = useState(true);
  const [sidebarCollapsed, { toggle: toggleSidebar }] = useDisclosure();
  const [drawerOpened, { open: openDrawer, close: closeDrawer }] =
    useDisclosure();

  const fetchItem = useCallback(async () => {
    if (!orderKey || !revNo) return;
    setLoading(true);
    try {
      const result = await api.get<OrderRevision>(
        `orders/${orderKey}/revs/${revNo}`,
      );
      setItem(result);
    } catch (err) {
      showErrorNotification(err);
    } finally {
      setLoading(false);
    }
  }, [orderKey, revNo]);

  useEffect(() => {
    void fetchItem();
  }, [fetchItem]);

  // Close drawer on navigation
  useEffect(() => {
    closeDrawer();
  }, [location.pathname]);

  if (loading) {
    return (
      <Stack align="center" py="xl">
        <Loader />
      </Stack>
    );
  }

  if (!item || !orderKey || !revNo) {
    return (
      <Box p="md">
        <Text>Revision not found.</Text>
      </Box>
    );
  }

  return (
    <Box display="flex" style={{ flexDirection: "column", flex: 1, minHeight: 0 }}>
      {/* Header */}
      <RevisionHeader
        item={item}
        orderKey={orderKey}
        revNo={revNo}
        onRefresh={fetchItem}
      />

      {/* Body: sidebar + content */}
      <Box display="flex" style={{ flex: 1, minHeight: 0 }}>
        {/* Mobile operation picker */}
        <Group
          gap="xs"
          px="md"
          py="xs"
          hiddenFrom="md"
          style={{ cursor: "pointer" }}
          onClick={openDrawer}
        >
          <ActionIcon variant="subtle" color="gray">
            <IconListDetails size="1.2rem" />
          </ActionIcon>
          <Text size="sm" fw={500}>
            Operations
          </Text>
        </Group>

        {/* Desktop sidebar */}
        <Box
          visibleFrom="md"
          style={{
            flexShrink: 0,
            display: "flex",
            flexDirection: "column",
          }}
        >
          {sidebarCollapsed ? (
            <Box
              style={{
                borderRight: "1px solid var(--mantine-color-dark-4)",
                paddingRight: 4,
              }}
            >
              <Tooltip label="Expand sidebar" position="right">
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  onClick={toggleSidebar}
                >
                  <IconLayoutSidebarLeftExpand size="1.2rem" />
                </ActionIcon>
              </Tooltip>
            </Box>
          ) : (
            <Box
              style={{
                width: SIDEBAR_WIDTH,
                minWidth: SIDEBAR_WIDTH,
                borderRight: "1px solid var(--mantine-color-dark-4)",
                display: "flex",
                flexDirection: "column",
                overflowY: "auto",
                paddingRight: "var(--mantine-spacing-md)",
              }}
            >
              <Group justify="flex-end" p={4}>
                <Tooltip label="Collapse sidebar" position="right">
                  <ActionIcon
                    variant="subtle"
                    color="gray"
                    size="sm"
                    onClick={toggleSidebar}
                  >
                    <IconLayoutSidebarLeftCollapse size="1rem" />
                  </ActionIcon>
                </Tooltip>
              </Group>
              <OperationSidebar orderKey={orderKey} revNo={revNo} />
            </Box>
          )}
        </Box>

        {/* Main content */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <Outlet />
        </div>
      </Box>

      {/* Mobile drawer */}
      <Drawer
        opened={drawerOpened}
        onClose={closeDrawer}
        title="Operations"
        size={SIDEBAR_WIDTH}
      >
        <OperationSidebar orderKey={orderKey} revNo={revNo} />
      </Drawer>
    </Box>
  );
};
