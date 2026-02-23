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
import { ImageModelSchema } from "@naisys/common";
import { IconCheck, IconX } from "@tabler/icons-react";
import type { ImageModelDetail } from "../lib/apiClient";
import { zodResolver } from "../lib/zod-resolver";

interface ImageFormValues {
  key: string;
  label: string;
  versionName: string;
  size: string;
  baseUrl: string;
  apiKeyVar: string;
  cost: number | string;
  quality: string;
}

function transformFormValues(values: ImageFormValues): Record<string, unknown> {
  const result: Record<string, unknown> = {
    key: values.key,
    label: values.label,
    versionName: values.versionName,
    size: values.size,
    apiKeyVar: values.apiKeyVar,
    cost: typeof values.cost === "number" ? values.cost : 0,
  };
  if (values.baseUrl) result.baseUrl = values.baseUrl;
  if (values.quality) result.quality = values.quality;
  return result;
}

interface ImageModelFormProps {
  model?: ImageModelDetail;
  isNew?: boolean;
  readOnly?: boolean;
  saving?: boolean;
  onSave?: (model: Record<string, unknown>) => void;
  onCancel?: () => void;
}

export const ImageModelForm: React.FC<ImageModelFormProps> = ({
  model,
  isNew,
  readOnly,
  saving,
  onSave,
  onCancel,
}) => {
  const form = useForm<ImageFormValues>({
    initialValues: {
      key: model?.key ?? "",
      label: model?.label ?? "",
      versionName: model?.versionName ?? "",
      size: model?.size ?? "1024x1024",
      baseUrl: model?.baseUrl ?? "",
      apiKeyVar: model?.apiKeyVar ?? "",
      cost: model?.cost ?? 0,
      quality: model?.quality ?? "",
    },
    validate: (values) =>
      zodResolver(ImageModelSchema)(transformFormValues(values)),
  });

  const handleSubmit = (values: ImageFormValues) => {
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
          Configuration
        </Text>
        <TextInput
          label="Size"
          description='Image dimensions (e.g. "1024x1024")'
          withAsterisk
          disabled={readOnly}
          {...form.getInputProps("size")}
        />
        <TextInput
          label="Base URL"
          description="Custom API endpoint (optional)"
          disabled={readOnly}
          {...form.getInputProps("baseUrl")}
        />
        <TextInput
          label="API Key Var"
          description="Variable name for the API key"
          disabled={readOnly}
          {...form.getInputProps("apiKeyVar")}
        />
        <Select
          label="Quality"
          description="Image quality level (optional)"
          disabled={readOnly}
          clearable
          data={[
            { value: "standard", label: "Standard" },
            { value: "hd", label: "HD" },
            { value: "high", label: "High" },
            { value: "medium", label: "Medium" },
            { value: "low", label: "Low" },
          ]}
          {...form.getInputProps("quality")}
        />

        <Text fw={600} size="sm" c="dimmed">
          Cost
        </Text>
        <NumberInput
          label="Cost per Image ($)"
          disabled={readOnly}
          min={0}
          decimalScale={4}
          {...form.getInputProps("cost")}
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
