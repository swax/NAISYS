import {
  Button,
  Group,
  NumberInput,
  Select,
  Stack,
  Switch,
  Textarea,
  TextInput,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import type { AgentConfigFile } from "@naisys/common";
import {
  AgentConfigFileSchema,
  applyAdminConfigInvariants,
  toRecord,
} from "@naisys/common";
import { IconCheck, IconX } from "@tabler/icons-react";
import { useMemo } from "react";

interface ModelOption {
  value: string;
  label: string;
}

interface AdminConfigFormProps {
  config: AgentConfigFile;
  imageModelOptions: ModelOption[];
  saving?: boolean;
  onSave: (config: AgentConfigFile) => void;
}

interface AdminFormValues {
  title: string;
  agentPrompt: string;
  imageModel: string;
  spendLimitDollars: number | string;
  spendLimitHours: number | string;
  mailEnabled: boolean;
  chatEnabled: boolean;
  webEnabled: boolean;
  browserEnabled: boolean;
  controlDesktop: boolean;
}

/** Field help text pulled from the shared schema's .describe() calls. */
const fieldDescriptions: Record<string, string | undefined> = toRecord(
  Object.entries(AgentConfigFileSchema.shape),
  ([key]) => key,
  ([, zodType]) => (zodType as { description?: string }).description,
);

function desc(field: string): string | undefined {
  return fieldDescriptions[field];
}

/** A blank NumberInput means "unset"; anything else is the parsed number. */
function optionalNumber(value: number | string): number | undefined {
  if (typeof value === "number") return value;
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  const parsed = Number(trimmed);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * Config editor for the admin user — NAISYS's no-model diagnostic console.
 * Surfaces only the settings that apply to a console; the LLM-loop fields are
 * pinned by `applyAdminConfigInvariants` and intentionally not shown. That pin
 * is re-applied on submit so what we send matches what the server stores.
 *
 * Fields the admin doesn't edit (tokenMax, debugPauseSeconds, wakeOnMessage)
 * are simply not shown — their stored values pass through untouched on save.
 */
export const AdminConfigForm: React.FC<AdminConfigFormProps> = ({
  config,
  imageModelOptions,
  saving,
  onSave,
}) => {
  const form = useForm<AdminFormValues>({
    initialValues: {
      title: config.title,
      agentPrompt: config.agentPrompt,
      imageModel: config.imageModel ?? "",
      spendLimitDollars: config.spendLimitDollars ?? "",
      spendLimitHours: config.spendLimitHours ?? "",
      mailEnabled: config.mailEnabled ?? false,
      chatEnabled: config.chatEnabled ?? false,
      webEnabled: config.webEnabled ?? false,
      browserEnabled: config.browserEnabled ?? false,
      controlDesktop: config.controlDesktop ?? false,
    },
    validate: {
      agentPrompt: (value) =>
        value.trim() ? null : "Agent prompt is required",
    },
  });

  // Keep a saved image model selectable even if it's no longer in the models
  // list (e.g. it was removed after being configured).
  const imageData = useMemo(() => {
    const options = [...imageModelOptions];
    const current = config.imageModel;
    if (current && !options.some((o) => o.value === current)) {
      options.unshift({ value: current, label: current });
    }
    return options;
  }, [imageModelOptions, config.imageModel]);

  const handleSubmit = (values: AdminFormValues) => {
    onSave(
      applyAdminConfigInvariants({
        ...config,
        title: values.title,
        agentPrompt: values.agentPrompt,
        imageModel: values.imageModel || undefined,
        spendLimitDollars: optionalNumber(values.spendLimitDollars),
        spendLimitHours: optionalNumber(values.spendLimitHours),
        mailEnabled: values.mailEnabled,
        chatEnabled: values.chatEnabled,
        webEnabled: values.webEnabled,
        browserEnabled: values.browserEnabled,
        controlDesktop: values.controlDesktop,
      }),
    );
  };

  return (
    <form onSubmit={form.onSubmit(handleSubmit)}>
      <Stack gap="lg" maw={500}>
        <TextInput
          label="Title"
          description={desc("title")}
          {...form.getInputProps("title")}
        />
        <Textarea
          label="Agent Prompt"
          description={desc("agentPrompt")}
          withAsterisk
          autosize
          minRows={4}
          spellCheck={false}
          styles={{
            input: { fontFamily: "monospace", fontSize: "0.875rem" },
          }}
          {...form.getInputProps("agentPrompt")}
        />
        <Select
          label="Image Model"
          description="Model used by the image-generation command — set this to exercise and diagnose image generation from the console."
          searchable
          clearable
          data={imageData}
          {...form.getInputProps("imageModel")}
        />
        <NumberInput
          label="Spend Limit ($)"
          description={desc("spendLimitDollars")}
          min={0}
          decimalScale={2}
          {...form.getInputProps("spendLimitDollars")}
        />
        <NumberInput
          label="Spend Limit Hours"
          description={desc("spendLimitHours")}
          min={0}
          {...form.getInputProps("spendLimitHours")}
        />
        <Switch
          label="Mail Enabled"
          description={desc("mailEnabled")}
          {...form.getInputProps("mailEnabled", { type: "checkbox" })}
        />
        <Switch
          label="Chat Enabled"
          description={desc("chatEnabled")}
          {...form.getInputProps("chatEnabled", { type: "checkbox" })}
        />
        <Switch
          label="Text Web"
          description={desc("webEnabled")}
          {...form.getInputProps("webEnabled", { type: "checkbox" })}
        />
        <Switch
          label="Headless Browser"
          description={desc("browserEnabled")}
          {...form.getInputProps("browserEnabled", { type: "checkbox" })}
        />
        <Switch
          label="Control Desktop"
          description={desc("controlDesktop")}
          {...form.getInputProps("controlDesktop", { type: "checkbox" })}
        />

        {form.isDirty() && (
          <Group
            pt="sm"
            mt="sm"
            style={{
              borderTop: "1px solid var(--mantine-color-default-border)",
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
              onClick={() => form.reset()}
              disabled={saving}
            >
              Discard
            </Button>
          </Group>
        )}
      </Stack>
    </form>
  );
};
