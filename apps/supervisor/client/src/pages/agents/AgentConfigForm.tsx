import {
  Button,
  Group,
  NumberInput,
  Select,
  type SelectProps,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import {
  AgentConfigFile,
  AgentConfigFileSchema,
  CommandProtection,
} from "@naisys/common";
import { IconCheck, IconX } from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useBlocker } from "react-router-dom";

import { zodResolver } from "../../lib/zod-resolver";

interface ModelOption {
  value: string;
  label: string;
}

interface AgentConfigFormProps {
  config: AgentConfigFile;
  llmModelOptions: ModelOption[];
  imageModelOptions: ModelOption[];
  saving?: boolean;
  onSave?: (config: AgentConfigFile) => void;
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

  if (values.imageModel) result.imageModel = values.imageModel;
  if (typeof values.spendLimitDollars === "number")
    result.spendLimitDollars = values.spendLimitDollars;
  if (typeof values.spendLimitHours === "number")
    result.spendLimitHours = values.spendLimitHours;

  if (values.mailEnabled) result.mailEnabled = true;
  if (values.chatEnabled) result.chatEnabled = true;
  if (values.webEnabled) result.webEnabled = true;
  if (values.completeSessionEnabled) result.completeSessionEnabled = true;
  if (values.wakeOnMessage) result.wakeOnMessage = true;
  if (values.workspacesEnabled) result.workspacesEnabled = true;
  if (values.multipleCommandsEnabled) result.multipleCommandsEnabled = true;

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
  imageModel: string;
  tokenMax: number | string;
  spendLimitDollars: number | string;
  spendLimitHours: number | string;
  mailEnabled: boolean;
  chatEnabled: boolean;
  webEnabled: boolean;
  completeSessionEnabled: boolean;
  wakeOnMessage: boolean;
  workspacesEnabled: boolean;
  multipleCommandsEnabled: boolean;
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
  saving,
  onSave,
}) => {
  const form = useForm<FormValues>({
    initialValues: {
      username: config.username,
      title: config.title,
      agentPrompt: config.agentPrompt,
      shellModel: config.shellModel,
      imageModel: config.imageModel ?? "",
      tokenMax: config.tokenMax,
      spendLimitDollars: config.spendLimitDollars ?? ("" as number | string),
      spendLimitHours: config.spendLimitHours ?? ("" as number | string),
      mailEnabled: config.mailEnabled ?? false,
      chatEnabled: config.chatEnabled ?? false,
      webEnabled: config.webEnabled ?? false,
      completeSessionEnabled: config.completeSessionEnabled ?? false,
      wakeOnMessage: config.wakeOnMessage ?? false,
      workspacesEnabled: config.workspacesEnabled ?? false,
      multipleCommandsEnabled: config.multipleCommandsEnabled ?? false,
      commandProtection: config.commandProtection ?? CommandProtection.None,
      debugPauseSeconds: config.debugPauseSeconds ?? 0,
      initialCommands: config.initialCommands?.join("\n") ?? "",
    },
    validate: (values) =>
      zodResolver(AgentConfigFileSchema)(transformFormValues(values)),
  });

  const isDirty = form.isDirty();

  // Block in-app navigation while form has unsaved changes
  const blocker = useBlocker(isDirty);

  useEffect(() => {
    if (blocker.state === "blocked") {
      if (window.confirm("You have unsaved changes. Leave this page?")) {
        blocker.proceed();
      } else {
        blocker.reset();
      }
    }
  }, [blocker]);

  // Block browser refresh/close while form has unsaved changes
  const handleBeforeUnload = useCallback(
    (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
      }
    },
    [isDirty],
  );

  useEffect(() => {
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [handleBeforeUnload]);

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
          {...form.getInputProps("username")}
        />
        <TextInput
          label="Title"
          description={desc("title")}
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
          data={llmModelOptions}
          {...form.getInputProps("shellModel")}
        />
        <ModelSelect
          label="Image Model"
          description={desc("imageModel")}
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
          min={1}
          {...form.getInputProps("tokenMax")}
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

        {/* Features */}
        <Text fw={600} size="sm" c="dimmed">
          Features
        </Text>
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
          label="Web Enabled"
          description={desc("webEnabled")}
          {...form.getInputProps("webEnabled", { type: "checkbox" })}
        />
        <Switch
          label="Complete Session Enabled"
          description={desc("completeSessionEnabled")}
          {...form.getInputProps("completeSessionEnabled", {
            type: "checkbox",
          })}
        />
        <Switch
          label="Wake On Message"
          description={desc("wakeOnMessage")}
          {...form.getInputProps("wakeOnMessage", { type: "checkbox" })}
        />
        <Switch
          label="Workspaces Enabled"
          description={desc("workspacesEnabled")}
          {...form.getInputProps("workspacesEnabled", { type: "checkbox" })}
        />
        <Switch
          label="Multiple Commands Enabled"
          description={desc("multipleCommandsEnabled")}
          {...form.getInputProps("multipleCommandsEnabled", {
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
          min={0}
          {...form.getInputProps("debugPauseSeconds")}
        />
        <Textarea
          label="Initial Commands"
          description={desc("initialCommands")}
          autosize
          minRows={2}
          styles={{
            input: { fontFamily: "monospace", fontSize: "0.875rem" },
          }}
          {...form.getInputProps("initialCommands")}
        />
      </Stack>

      {/* Sticky Save / Discard */}
      {isDirty && (
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
            onClick={() => form.reset()}
            disabled={saving}
          >
            Discard
          </Button>
        </Group>
      )}
    </form>
  );
};
