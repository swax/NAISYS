import React from "react";
import { Text } from "@mantine/core";
import { useParams } from "react-router-dom";

export const Controls: React.FC = () => {
  const { agent } = useParams<{ agent: string }>();

  return <Text size="xl">{agent ? `Controls for ${agent}` : "Controls"}</Text>;
};
