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
import type { OrderRun } from "@naisys-erp/shared";
import {
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconListDetails,
} from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";
import { Outlet, useLocation, useParams } from "react-router";

import { api, apiEndpoints, showErrorNotification } from "../../../lib/api";
import { OperationRunSidebar } from "./OperationRunSidebar";
import { OrderRunHeader } from "./OrderRunHeader";

export interface OrderRunOutletContext {
  onOperationUpdate: () => void;
  orderRun: OrderRun;
  onOrderRunUpdate: (item: OrderRun) => void;
}

const SIDEBAR_WIDTH = 260;

export const OrderRunLayout: React.FC = () => {
  const { orderKey, id } = useParams<{
    orderKey: string;
    id: string;
  }>();
  const location = useLocation();
  const [item, setItem] = useState<OrderRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [sidebarCollapsed, { toggle: toggleSidebar }] = useDisclosure();
  const [drawerOpened, { open: openDrawer, close: closeDrawer }] =
    useDisclosure();
  const [opsRefreshKey, setOpsRefreshKey] = useState(0);

  const outletContext: OrderRunOutletContext = {
    onOperationUpdate: () => setOpsRefreshKey((k) => k + 1),
    orderRun: item!,
    onOrderRunUpdate: setItem,
  };

  const fetchItem = useCallback(async () => {
    if (!orderKey || !id) return;
    setLoading(true);
    try {
      const result = await api.get<OrderRun>(
        apiEndpoints.orderRun(orderKey, id),
      );
      setItem(result);
    } catch (err) {
      showErrorNotification(err);
    } finally {
      setLoading(false);
    }
  }, [orderKey, id]);

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

  if (!item || !orderKey || !id) {
    return (
      <Box p="md">
        <Text>Order run not found.</Text>
      </Box>
    );
  }

  return (
    <Box
      display="flex"
      style={{
        flexDirection: "column",
        height: "calc(100dvh - var(--app-shell-header-height, 0px))",
      }}
    >
      {/* Header */}
      <OrderRunHeader
        item={item}
        orderKey={orderKey}
        runId={id}
        onUpdate={setItem}
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
                padding: "0 var(--mantine-spacing-md)",
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
              <OperationRunSidebar
                orderKey={orderKey}
                runId={id}
                refreshKey={opsRefreshKey}
              />
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
          <Outlet context={outletContext} />
        </div>
      </Box>

      {/* Mobile drawer */}
      <Drawer
        opened={drawerOpened}
        onClose={closeDrawer}
        title="Operations"
        size={SIDEBAR_WIDTH}
      >
        <OperationRunSidebar
          orderKey={orderKey}
          runId={id}
          refreshKey={opsRefreshKey}
        />
      </Drawer>
    </Box>
  );
};
