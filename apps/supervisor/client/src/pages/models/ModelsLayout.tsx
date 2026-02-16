import { ActionIcon, Box, Drawer, Group } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconCpu } from "@tabler/icons-react";
import React from "react";
import { Outlet, useLocation, useOutletContext } from "react-router-dom";
import { ModelSidebar } from "../../headers/ModelSidebar";
import type { HateoasAction } from "@naisys/common";
import {
  api,
  apiEndpoints,
  type LlmModelDetail,
  type ImageModelDetail,
  type ModelsResponse,
} from "../../lib/apiClient";

const SIDEBAR_WIDTH = 300;

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
    refreshModels().finally(() => setIsLoading(false));
  }, [refreshModels]);

  // Close drawer on navigation
  React.useEffect(() => {
    closeDrawer();
  }, [location.pathname]);

  const context: ModelsOutletContext = {
    llmModels,
    imageModels,
    actions,
    isLoading,
    refreshModels,
  };

  return (
    <div
      style={{
        display: "flex",
        height: "calc(100vh - 48px - 2 * var(--mantine-spacing-md))",
      }}
    >
      {/* Desktop sidebar */}
      <Box
        visibleFrom="sm"
        style={{
          width: SIDEBAR_WIDTH,
          flexShrink: 0,
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
      </Box>

      {/* Main content */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
          paddingLeft: "var(--mantine-spacing-md)",
        }}
      >
        {/* Sub-header: mobile model icon */}
        <Group mb="md" gap="xs">
          <ActionIcon
            variant="subtle"
            color="gray"
            onClick={openDrawer}
            hiddenFrom="sm"
          >
            <IconCpu size="1.2rem" />
          </ActionIcon>
        </Group>

        {/* Route content */}
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
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
    </div>
  );
};
