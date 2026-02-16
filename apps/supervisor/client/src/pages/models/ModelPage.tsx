import { Stack, Table, Text, Title } from "@mantine/core";
import React from "react";
import { useParams } from "react-router-dom";
import { useModelsContext } from "./ModelsLayout";

export const ModelPage: React.FC = () => {
  const { key } = useParams<{ key: string }>();
  const { llmModels, imageModels } = useModelsContext();

  const llm = llmModels.find((m) => m.key === key);
  const img = imageModels.find((m) => m.key === key);

  if (!llm && !img) {
    return (
      <Stack gap="md">
        <Text c="dimmed" ta="center">
          Model not found
        </Text>
      </Stack>
    );
  }

  if (llm) {
    const rows: [string, string | number][] = [
      ["Key", llm.key],
      ["Label", llm.label],
      ["Version Name", llm.versionName],
      ["API Type", llm.apiType],
      ["Base URL", llm.baseUrl || "—"],
      ["Key Env Var", llm.keyEnvVar || "—"],
      ["Max Tokens", llm.maxTokens.toLocaleString()],
      ["Input Cost (per 1M tokens)", `$${llm.inputCost}`],
      ["Output Cost (per 1M tokens)", `$${llm.outputCost}`],
    ];
    if (llm.cacheWriteCost !== undefined) {
      rows.push(["Cache Write Cost (per 1M tokens)", `$${llm.cacheWriteCost}`]);
    }
    if (llm.cacheReadCost !== undefined) {
      rows.push(["Cache Read Cost (per 1M tokens)", `$${llm.cacheReadCost}`]);
    }

    return (
      <Stack gap="md">
        <Title order={2}>{llm.label}</Title>
        <Table striped>
          <Table.Tbody>
            {rows.map(([label, value]) => (
              <Table.Tr key={label}>
                <Table.Td fw={500} w="40%">
                  {label}
                </Table.Td>
                <Table.Td>{value}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Stack>
    );
  }

  // Image model
  const imgModel = img!;
  const rows: [string, string | number][] = [
    ["Key", imgModel.key],
    ["Label", imgModel.label],
    ["Version Name", imgModel.versionName],
    ["Size", imgModel.size],
    ["Base URL", imgModel.baseUrl || "—"],
    ["Key Env Var", imgModel.keyEnvVar || "—"],
    ["Cost (per image)", `$${imgModel.cost}`],
  ];
  if (imgModel.quality) {
    rows.push(["Quality", imgModel.quality]);
  }

  return (
    <Stack gap="md">
      <Title order={2}>{imgModel.label}</Title>
      <Table striped>
        <Table.Tbody>
          {rows.map(([label, value]) => (
            <Table.Tr key={label}>
              <Table.Td fw={500} w="40%">
                {label}
              </Table.Td>
              <Table.Td>{value}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Stack>
  );
};
