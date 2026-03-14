import { Box, Drawer, Group, Text, UnstyledButton } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import type { HateoasAction } from "@naisys/common";
import { IconCpu } from "@tabler/icons-react";
import React from "react";
import {
  Outlet,
  useLocation,
  useOutletContext,
  useParams,
} from "react-router-dom";

import { CollapsibleSidebar } from "../../components/CollapsibleSidebar";
import { HEADER_ROW_HEIGHT, SIDEBAR_WIDTH } from "../../constants";
import { ModelSidebar } from "../../headers/ModelSidebar";
import {
  api,
  apiEndpoints,
  type ImageModelDetail,
  type LlmModelDetail,
  type ModelsResponse,
} from "../../lib/apiClient";

export interface ModelsOutletContext {
  llmModels: LlmModelDetail[];
  imageModels: ImageModelDetail[];
  actions: HateoasAction[] | undefined;
  isLoading: boolean;
  refreshModels: () => Promise<void>;
}

export function useModelsContext() {
  return useOutletContext<ModelsOutletContext>();
}

export const ModelsLayout: React.FC = () => {
  const [drawerOpened, { open: openDrawer, close: closeDrawer }] =
    useDisclosure();
  const location = useLocation();
  const { key: modelKey } = useParams<{ key: string }>();
  const [llmModels, setLlmModels] = React.useState<LlmModelDetail[]>([]);
  const [imageModels, setImageModels] = React.useState<ImageModelDetail[]>([]);
  const [actions, setActions] = React.useState<HateoasAction[] | undefined>();
  const [isLoading, setIsLoading] = React.useState(true);

  const refreshModels = React.useCallback(async () => {
    try {
      const data = await api.get<ModelsResponse>(apiEndpoints.models);
      setLlmModels(data.llmModelDetails);
      setImageModels(data.imageModelDetails);
      setActions(data._actions);
    } catch {
      // ignore
    }
  }, []);

  React.useEffect(() => {
    void refreshModels().finally(() => setIsLoading(false));
  }, [refreshModels]);

  // Close drawer on navigation
  React.useEffect(() => {
    closeDrawer();
  }, [location.pathname]);

  // Derive mobile sub-header label from route
  const mobileLabel = modelKey
    ? modelKey
    : location.pathname.endsWith("/calculator")
      ? "Calculator"
      : "Overview";

  const context: ModelsOutletContext = {
    llmModels,
    imageModels,
    actions,
    isLoading,
    refreshModels,
  };

  return (
    <Box display="flex" style={{ flex: 1, minHeight: 0 }}>
      {/* Desktop sidebar */}
      <CollapsibleSidebar
        contentStyle={{
          overflowY: "auto",
          paddingRight: "var(--mantine-spacing-md)",
        }}
      >
        <ModelSidebar
          llmModels={llmModels}
          imageModels={imageModels}
          actions={actions}
          isLoading={isLoading}
        />
      </CollapsibleSidebar>

      {/* Main content */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
        }}
      >
        {/* Sub-header: mobile model picker */}
        <UnstyledButton
          onClick={openDrawer}
          hiddenFrom="sm"
          h={HEADER_ROW_HEIGHT}
          pl="md"
          style={{
            flexShrink: 0,
            borderBottom:
              "calc(0.125rem * var(--mantine-scale)) solid var(--mantine-color-dark-4)",
          }}
        >
          <Group gap="xs" style={{ height: "100%" }}>
            <IconCpu size="1.2rem" color="var(--mantine-color-dimmed)" />
            <Text size="sm" fw={600}>
              {mobileLabel}
            </Text>
          </Group>
        </UnstyledButton>

        {/* Route content */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            padding: "var(--mantine-spacing-md)",
          }}
        >
          <Outlet context={context} />
        </div>
      </div>

      {/* Mobile drawer for model sidebar */}
      <Drawer
        opened={drawerOpened}
        onClose={closeDrawer}
        title="Models"
        size={SIDEBAR_WIDTH}
      >
        <ModelSidebar
          llmModels={llmModels}
          imageModels={imageModels}
          actions={actions}
          isLoading={isLoading}
        />
      </Drawer>
    </Box>
  );
};
