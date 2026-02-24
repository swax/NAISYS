import { Stack, Text } from "@mantine/core";
import React, { useEffect } from "react";
import { useNavigate } from "react-router-dom";

import { useHostDataContext } from "../../contexts/HostDataContext";

export const HostIndex: React.FC = () => {
  const { hosts } = useHostDataContext();
  const navigate = useNavigate();

  useEffect(() => {
    if (hosts.length > 0) {
      navigate(`/hosts/${hosts[0].id}`, { replace: true });
    }
  }, [hosts, navigate]);

  return (
    <Stack gap="md">
      <Text c="dimmed" ta="center">
        Select a host from the sidebar
      </Text>
    </Stack>
  );
};
