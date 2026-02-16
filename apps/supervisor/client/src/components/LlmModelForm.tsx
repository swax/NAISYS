import { LlmApiType, LlmModelSchema } from "@naisys/common";
import {
  Button,
  Group,
  NumberInput,
  Select,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { IconCheck, IconX } from "@tabler/icons-react";
import type { LlmModelDetail } from "../lib/apiClient";
import { zodResolver } from "../lib/zod-resolver";

interface LlmFormValues {
  key: string;
  label: string;
  versionName: string;
  apiType: string;
  maxTokens: number | string;
  baseUrl: string;
  keyEnvVar: string;
  inputCost: number | string;
  outputCost: number | string;
  cacheWriteCost: number | string;
  cacheReadCost: number | string;
}

function transformFormValues(values: LlmFormValues): Record<string, unknown> {
  const result: Record<string, unknown> = {
    key: values.key,
    label: values.label,
    versionName: values.versionName,
    apiType: values.apiType,
    maxTokens: values.maxTokens,
    keyEnvVar: values.keyEnvVar,
    inputCost: typeof values.inputCost === "number" ? values.inputCost : 0,
    outputCost: typeof values.outputCost === "number" ? values.outputCost : 0,
  };
  if (values.baseUrl) result.baseUrl = values.baseUrl;
  if (typeof values.cacheWriteCost === "number")
    result.cacheWriteCost = values.cacheWriteCost;
  if (typeof values.cacheReadCost === "number")
    result.cacheReadCost = values.cacheReadCost;
  return result;
}

interface LlmModelFormProps {
  model?: LlmModelDetail;
  isNew?: boolean;
  readOnly?: boolean;
  saving?: boolean;
  onSave?: (model: Record<string, unknown>) => void;
  onCancel?: () => void;
}

const apiTypeOptions = Object.values(LlmApiType).map((v) => ({
  value: v,
  label: v,
}));

export const LlmModelForm: React.FC<LlmModelFormProps> = ({
  model,
  isNew,
  readOnly,
  saving,
  onSave,
  onCancel,
}) => {
  const form = useForm<LlmFormValues>({
    initialValues: {
      key: model?.key ?? "",
      label: model?.label ?? "",
      versionName: model?.versionName ?? "",
      apiType: model?.apiType ?? LlmApiType.OpenAI,
      maxTokens: model?.maxTokens ?? 128000,
      baseUrl: model?.baseUrl ?? "",
      keyEnvVar: model?.keyEnvVar ?? "",
      inputCost: model?.inputCost ?? 0,
      outputCost: model?.outputCost ?? 0,
      cacheWriteCost: model?.cacheWriteCost ?? ("" as number | string),
      cacheReadCost: model?.cacheReadCost ?? ("" as number | string),
    },
    validate: (values) =>
      zodResolver(LlmModelSchema)(transformFormValues(values)),
  });

  const handleSubmit = (values: LlmFormValues) => {
    onSave?.(transformFormValues(values));
  };

  return (
    <form onSubmit={form.onSubmit(handleSubmit)}>
      <Stack gap="lg">
        <Text fw={600} size="sm" c="dimmed">
          Identity
        </Text>
        <TextInput
          label="Key"
          description="Unique identifier for this model"
          withAsterisk
          disabled={readOnly || (!isNew && !!model)}
          {...form.getInputProps("key")}
        />
        <TextInput
          label="Label"
          description="Display name"
          withAsterisk
          disabled={readOnly}
          {...form.getInputProps("label")}
        />
        <TextInput
          label="Version Name"
          description="Model version string sent to the API"
          withAsterisk
          disabled={readOnly}
          {...form.getInputProps("versionName")}
        />

        <Text fw={600} size="sm" c="dimmed">
          API Configuration
        </Text>
        <Select
          label="API Type"
          withAsterisk
          disabled={readOnly}
          data={apiTypeOptions}
          {...form.getInputProps("apiType")}
        />
        <TextInput
          label="Base URL"
          description="Custom API endpoint (optional)"
          disabled={readOnly}
          {...form.getInputProps("baseUrl")}
        />
        <TextInput
          label="Key Env Var"
          description="Environment variable name for the API key"
          disabled={readOnly}
          {...form.getInputProps("keyEnvVar")}
        />
        <NumberInput
          label="Max Tokens"
          withAsterisk
          disabled={readOnly}
          min={1}
          {...form.getInputProps("maxTokens")}
        />

        <Text fw={600} size="sm" c="dimmed">
          Costs (per 1M tokens)
        </Text>
        <NumberInput
          label="Input Cost ($)"
          disabled={readOnly}
          min={0}
          decimalScale={4}
          {...form.getInputProps("inputCost")}
        />
        <NumberInput
          label="Output Cost ($)"
          disabled={readOnly}
          min={0}
          decimalScale={4}
          {...form.getInputProps("outputCost")}
        />
        <NumberInput
          label="Cache Write Cost ($)"
          disabled={readOnly}
          min={0}
          decimalScale={4}
          {...form.getInputProps("cacheWriteCost")}
        />
        <NumberInput
          label="Cache Read Cost ($)"
          disabled={readOnly}
          min={0}
          decimalScale={4}
          {...form.getInputProps("cacheReadCost")}
        />
      </Stack>

      {!readOnly && (
        <Group
          style={{
            position: "sticky",
            bottom: 0,
            backgroundColor: "var(--mantine-color-body)",
            borderTop: "1px solid var(--mantine-color-default-border)",
            padding: "var(--mantine-spacing-sm) 0",
            zIndex: 10,
          }}
        >
          <Button
            type="submit"
            color="green"
            leftSection={<IconCheck size={16} />}
            loading={saving}
            disabled={saving}
          >
            Save
          </Button>
          <Button
            color="gray"
            leftSection={<IconX size={16} />}
            onClick={onCancel}
            disabled={saving}
          >
            Discard
          </Button>
        </Group>
      )}
    </form>
  );
};
