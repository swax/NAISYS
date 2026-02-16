import { ActionIcon, Box, Drawer, Group } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconCpu } from "@tabler/icons-react";
import React from "react";
import { Outlet, useLocation, useOutletContext } from "react-router-dom";
import { ModelSidebar } from "../../headers/ModelSidebar";
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
  isLoading: boolean;
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
  const [isLoading, setIsLoading] = React.useState(true);

  React.useEffect(() => {
    api
      .get<ModelsResponse>(apiEndpoints.models)
      .then((data) => {
        setLlmModels(data.llmModelDetails);
        setImageModels(data.imageModelDetails);
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, []);

  // Close drawer on navigation
  React.useEffect(() => {
    closeDrawer();
  }, [location.pathname]);

  const context: ModelsOutletContext = { llmModels, imageModels, isLoading };

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
          isLoading={isLoading}
        />
      </Drawer>
    </div>
  );
};
