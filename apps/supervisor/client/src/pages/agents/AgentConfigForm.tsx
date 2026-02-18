import {
  AgentConfigFile,
  AgentConfigFileSchema,
  CommandProtection,
} from "@naisys/common";
import {
  Button,
  Group,
  NumberInput,
  Select,
  type SelectProps,
  Stack,
  Switch,
  Text,
  TextInput,
  Textarea,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { IconCheck, IconX } from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { zodResolver } from "../../lib/zod-resolver";

interface ModelOption {
  value: string;
  label: string;
}

interface AgentConfigFormProps {
  config: AgentConfigFile;
  llmModelOptions: ModelOption[];
  imageModelOptions: ModelOption[];
  readOnly?: boolean;
  saving?: boolean;
  onSave?: (config: AgentConfigFile) => void;
  onCancel?: () => void;
}

/** Convert form values to AgentConfigFile, omitting empty optionals. */
function transformFormValues(values: FormValues): Record<string, unknown> {
  const result: Record<string, unknown> = {
    username: values.username,
    title: values.title,
    agentPrompt: values.agentPrompt,
    shellModel: values.shellModel,
    tokenMax: values.tokenMax,
  };

  if (values.webModel) result.webModel = values.webModel;
  if (values.compactModel) result.compactModel = values.compactModel;
  if (values.imageModel) result.imageModel = values.imageModel;
  if (typeof values.spendLimitDollars === "number")
    result.spendLimitDollars = values.spendLimitDollars;
  if (typeof values.spendLimitHours === "number")
    result.spendLimitHours = values.spendLimitHours;

  if (values.mailEnabled) result.mailEnabled = true;
  if (values.webEnabled) result.webEnabled = true;
  if (values.completeSessionEnabled) result.completeSessionEnabled = true;
  if (values.wakeOnMessage) result.wakeOnMessage = true;
  if (values.workspacesEnabled) result.workspacesEnabled = true;
  if (values.disableMultipleCommands) result.disableMultipleCommands = true;

  if (
    values.commandProtection &&
    values.commandProtection !== CommandProtection.None
  )
    result.commandProtection = values.commandProtection;
  if (typeof values.debugPauseSeconds === "number")
    result.debugPauseSeconds = values.debugPauseSeconds;
  if (values.initialCommands.trim())
    result.initialCommands = values.initialCommands.split("\n").filter(Boolean);

  return result;
}

interface FormValues {
  username: string;
  title: string;
  agentPrompt: string;
  shellModel: string;
  webModel: string;
  compactModel: string;
  imageModel: string;
  tokenMax: number | string;
  spendLimitDollars: number | string;
  spendLimitHours: number | string;
  mailEnabled: boolean;
  webEnabled: boolean;
  completeSessionEnabled: boolean;
  wakeOnMessage: boolean;
  workspacesEnabled: boolean;
  disableMultipleCommands: boolean;
  commandProtection: string;
  debugPauseSeconds: number | string;
  initialCommands: string;
}

/** Extract .describe() text from schema shape, keyed by field name. */
const fieldDescriptions: Record<string, string | undefined> =
  Object.fromEntries(
    Object.entries(AgentConfigFileSchema.shape).map(([key, zodType]) => [
      key,
      (zodType as { description?: string }).description,
    ]),
  );

function desc(field: string): string | undefined {
  return fieldDescriptions[field];
}

/** Select that allows typing ${VAR} template variables in addition to picking from options. */
function ModelSelect(props: SelectProps & { data: ModelOption[] }) {
  const { data, value, ...rest } = props;
  const [search, setSearch] = useState("");

  const effectiveData = useMemo(() => {
    const result = [...data];
    // Show current value even if not in options (e.g. a saved template variable)
    if (
      typeof value === "string" &&
      value &&
      !result.some((o) => o.value === value)
    ) {
      result.unshift({ value, label: value });
    }
    // Allow creating a template variable while typing
    if (
      search.startsWith("${") &&
      search.length > 2 &&
      !result.some((o) => o.value === search)
    ) {
      result.push({ value: search, label: search });
    }
    return result;
  }, [data, value, search]);

  return (
    <Select
      {...rest}
      searchable
      data={effectiveData}
      value={value}
      onSearchChange={setSearch}
      nothingFoundMessage="Type ${VAR} for a config variable"
    />
  );
}

export const AgentConfigForm: React.FC<AgentConfigFormProps> = ({
  config,
  llmModelOptions,
  imageModelOptions,
  readOnly,
  saving,
  onSave,
  onCancel,
}) => {
  const form = useForm<FormValues>({
    initialValues: {
      username: config.username,
      title: config.title,
      agentPrompt: config.agentPrompt,
      shellModel: config.shellModel,
      webModel: config.webModel ?? "",
      compactModel: config.compactModel ?? "",
      imageModel: config.imageModel ?? "",
      tokenMax: config.tokenMax,
      spendLimitDollars: config.spendLimitDollars ?? ("" as number | string),
      spendLimitHours: config.spendLimitHours ?? ("" as number | string),
      mailEnabled: config.mailEnabled ?? false,
      webEnabled: config.webEnabled ?? false,
      completeSessionEnabled: config.completeSessionEnabled ?? false,
      wakeOnMessage: config.wakeOnMessage ?? false,
      workspacesEnabled: config.workspacesEnabled ?? false,
      disableMultipleCommands: config.disableMultipleCommands ?? false,
      commandProtection: config.commandProtection ?? CommandProtection.None,
      debugPauseSeconds: config.debugPauseSeconds ?? ("" as number | string),
      initialCommands: config.initialCommands?.join("\n") ?? "",
    },
    validate: (values) =>
      zodResolver(AgentConfigFileSchema)(transformFormValues(values)),
  });

  const handleSubmit = (values: FormValues) => {
    const transformed = transformFormValues(values);
    const parsed = AgentConfigFileSchema.parse(transformed);
    onSave?.(parsed);
  };

  return (
    <form onSubmit={form.onSubmit(handleSubmit)}>
      <Stack gap="lg">
        {/* Identity */}
        <Text fw={600} size="sm" c="dimmed">
          Identity
        </Text>
        <TextInput
          label="Username"
          description={desc("username")}
          withAsterisk
          disabled={readOnly}
          {...form.getInputProps("username")}
        />
        <TextInput
          label="Title"
          description={desc("title")}
          disabled={readOnly}
          {...form.getInputProps("title")}
        />

        {/* Prompt */}
        <Text fw={600} size="sm" c="dimmed">
          Prompt
        </Text>
        <Textarea
          label="Agent Prompt"
          description={desc("agentPrompt")}
          withAsterisk
          disabled={readOnly}
          autosize
          minRows={4}
          styles={{
            input: { fontFamily: "monospace", fontSize: "0.875rem" },
          }}
          {...form.getInputProps("agentPrompt")}
        />

        {/* Models */}
        <Text fw={600} size="sm" c="dimmed">
          Models
        </Text>
        <ModelSelect
          label="Shell Model"
          description={desc("shellModel")}
          withAsterisk
          disabled={readOnly}
          data={llmModelOptions}
          {...form.getInputProps("shellModel")}
        />
        <ModelSelect
          label="Web Model"
          description={desc("webModel")}
          disabled={readOnly}
          clearable
          data={llmModelOptions}
          {...form.getInputProps("webModel")}
        />
        <ModelSelect
          label="Compact Model"
          description={desc("compactModel")}
          disabled={readOnly}
          clearable
          data={llmModelOptions}
          {...form.getInputProps("compactModel")}
        />
        <ModelSelect
          label="Image Model"
          description={desc("imageModel")}
          disabled={readOnly}
          clearable
          data={imageModelOptions}
          {...form.getInputProps("imageModel")}
        />

        {/* Limits */}
        <Text fw={600} size="sm" c="dimmed">
          Limits
        </Text>
        <NumberInput
          label="Token Max"
          description={desc("tokenMax")}
          withAsterisk
          disabled={readOnly}
          min={1}
          {...form.getInputProps("tokenMax")}
        />
        <NumberInput
          label="Spend Limit ($)"
          description={desc("spendLimitDollars")}
          disabled={readOnly}
          min={0}
          decimalScale={2}
          {...form.getInputProps("spendLimitDollars")}
        />
        <NumberInput
          label="Spend Limit Hours"
          description={desc("spendLimitHours")}
          disabled={readOnly}
          min={0}
          {...form.getInputProps("spendLimitHours")}
        />

        {/* Features */}
        <Text fw={600} size="sm" c="dimmed">
          Features
        </Text>
        <Switch
          label="Mail Enabled"
          description={desc("mailEnabled")}
          disabled={readOnly}
          {...form.getInputProps("mailEnabled", { type: "checkbox" })}
        />
        <Switch
          label="Web Enabled"
          description={desc("webEnabled")}
          disabled={readOnly}
          {...form.getInputProps("webEnabled", { type: "checkbox" })}
        />
        <Switch
          label="Complete Session Enabled"
          description={desc("completeSessionEnabled")}
          disabled={readOnly}
          {...form.getInputProps("completeSessionEnabled", {
            type: "checkbox",
          })}
        />
        <Switch
          label="Wake On Message"
          description={desc("wakeOnMessage")}
          disabled={readOnly}
          {...form.getInputProps("wakeOnMessage", { type: "checkbox" })}
        />
        <Switch
          label="Workspaces Enabled"
          description={desc("workspacesEnabled")}
          disabled={readOnly}
          {...form.getInputProps("workspacesEnabled", { type: "checkbox" })}
        />
        <Switch
          label="Disable Multiple Commands"
          description={desc("disableMultipleCommands")}
          disabled={readOnly}
          {...form.getInputProps("disableMultipleCommands", {
            type: "checkbox",
          })}
        />

        {/* Advanced */}
        <Text fw={600} size="sm" c="dimmed">
          Advanced
        </Text>
        <Select
          label="Command Protection"
          description={desc("commandProtection")}
          disabled={readOnly}
          data={[
            { value: CommandProtection.None, label: "None" },
            { value: CommandProtection.Manual, label: "Manual" },
            { value: CommandProtection.Auto, label: "Auto" },
          ]}
          {...form.getInputProps("commandProtection")}
        />
        <NumberInput
          label="Debug Pause Seconds"
          description={desc("debugPauseSeconds")}
          disabled={readOnly}
          min={0}
          {...form.getInputProps("debugPauseSeconds")}
        />
        <Textarea
          label="Initial Commands"
          description={desc("initialCommands")}
          disabled={readOnly}
          autosize
          minRows={2}
          styles={{
            input: { fontFamily: "monospace", fontSize: "0.875rem" },
          }}
          {...form.getInputProps("initialCommands")}
        />
      </Stack>

      {/* Sticky Save / Cancel */}
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
