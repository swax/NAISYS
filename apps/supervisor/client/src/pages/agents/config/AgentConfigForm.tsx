import {
  Accordion,
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
import type { AgentConfigFile, ScheduleEntry } from "@naisys/common";
import { AgentConfigFileSchema, toRecord } from "@naisys/common";
import { zodResolver } from "@naisys/common-browser";
import {
  IconCheck,
  IconClock,
  IconGauge,
  IconPaperclip,
  IconServer,
  IconSettings,
  IconToggleRight,
  IconTool,
  IconX,
} from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useBlocker } from "react-router-dom";

import { AgentAssignedHostsPanel } from "./AgentAssignedHostsPanel";
import { AgentSchedulesEditor } from "./AgentSchedulesEditor";
import { AgentStartupAttachments } from "./AgentStartupAttachments";

interface ModelOption {
  value: string;
  label: string;
}

interface HostOption {
  id: number;
  name: string;
}

interface AgentConfigFormProps {
  config: AgentConfigFile;
  username: string;
  llmModelOptions: ModelOption[];
  imageModelOptions: ModelOption[];
  /** Hub TZ for schedule preview computations; matches what the scheduler fires in. */
  hubTimezone: string;
  saving?: boolean;
  onSave?: (config: AgentConfigFile) => void;
  /** Optional element rendered inside General, after the Title field. */
  afterTitle?: React.ReactNode;
  /** Optional element rendered at the end of the Advanced section. */
  advancedExtras?: React.ReactNode;
  assignedHosts: HostOption[];
  availableHosts: HostOption[];
  hostActionInProgress?: boolean;
  onAssignHost?: (hostname: string) => void;
  onUnassignHost?: (hostname: string) => void;
  /** Controlled by parent so accordion state survives the save-driven remount. */
  expandedPanels: string[];
  onExpandedPanelsChange: (next: string[]) => void;
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
  if (values.browserEnabled) result.browserEnabled = true;
  if (values.completeSessionEnabled) result.completeSessionEnabled = true;
  if (values.wakeOnMessage) result.wakeOnMessage = true;
  if (values.workspacesEnabled) result.workspacesEnabled = true;
  if (values.multipleCommandsEnabled) result.multipleCommandsEnabled = true;
  if (values.controlDesktop) result.controlDesktop = true;
  if (values.supervisorApiHints) result.supervisorApiHints = true;
  if (values.autoCompact) result.autoCompact = true;

  if (values.commandProtection && values.commandProtection !== "none")
    result.commandProtection = values.commandProtection;
  if (values.continuity && values.continuity !== "fresh")
    result.continuity = values.continuity;
  if (typeof values.debugPauseSeconds === "number")
    result.debugPauseSeconds = values.debugPauseSeconds;
  if (values.initialCommands.trim())
    result.initialCommands = values.initialCommands
      .split(/\n\n+/)
      .map((s) => s.trim())
      .filter(Boolean);

  if (values.schedules.length > 0) {
    result.schedules = values.schedules.map((s) => ({
      name: s.name,
      cron: s.cron,
      enabled: s.enabled !== false,
      ...(s.prompt && s.prompt.trim() ? { prompt: s.prompt } : {}),
    }));
  }

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
  browserEnabled: boolean;
  completeSessionEnabled: boolean;
  wakeOnMessage: boolean;
  workspacesEnabled: boolean;
  multipleCommandsEnabled: boolean;
  controlDesktop: boolean;
  supervisorApiHints: boolean;
  autoCompact: boolean;
  commandProtection: string;
  continuity: string;
  debugPauseSeconds: number | string;
  initialCommands: string;
  schedules: ScheduleEntry[];
}

/** Extract .describe() text from schema shape, keyed by field name. */
const fieldDescriptions: Record<string, string | undefined> = toRecord(
  Object.entries(AgentConfigFileSchema.shape),
  ([key]) => key,
  ([, zodType]) => (zodType as { description?: string }).description,
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
  username,
  llmModelOptions,
  imageModelOptions,
  hubTimezone,
  saving,
  onSave,
  afterTitle,
  advancedExtras,
  assignedHosts,
  availableHosts,
  hostActionInProgress,
  onAssignHost,
  onUnassignHost,
  expandedPanels,
  onExpandedPanelsChange,
}) => {
  const sortedLlmModelOptions = useMemo(
    () => [...llmModelOptions].sort((a, b) => a.label.localeCompare(b.label)),
    [llmModelOptions],
  );

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
      browserEnabled: config.browserEnabled ?? false,
      completeSessionEnabled: config.completeSessionEnabled ?? false,
      wakeOnMessage: config.wakeOnMessage ?? false,
      workspacesEnabled: config.workspacesEnabled ?? false,
      multipleCommandsEnabled: config.multipleCommandsEnabled ?? false,
      controlDesktop: config.controlDesktop ?? false,
      supervisorApiHints: config.supervisorApiHints ?? false,
      autoCompact: config.autoCompact ?? false,
      commandProtection: config.commandProtection ?? "none",
      continuity: config.continuity ?? "fresh",
      debugPauseSeconds: config.debugPauseSeconds ?? 0,
      initialCommands: config.initialCommands?.join("\n\n") ?? "",
      schedules: config.schedules ?? [],
    },
    validate: (values) =>
      zodResolver(AgentConfigFileSchema)(transformFormValues(values)),
  });

  // Null until AgentStartupAttachments reports its first fetch.
  const [attachmentCount, setAttachmentCount] = useState<number | null>(null);

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

  const saveDiscardBar = isDirty ? (
    <Group
      pt="sm"
      mt="sm"
      style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}
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
  ) : null;

  const autoSaveNote = (
    <Text
      size="xs"
      c="dimmed"
      pt="sm"
      mt="sm"
      style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}
    >
      Changes save automatically.
    </Text>
  );

  return (
    <form onSubmit={form.onSubmit(handleSubmit)}>
      <Accordion
        multiple
        variant="separated"
        value={expandedPanels}
        onChange={onExpandedPanelsChange}
      >
        <Accordion.Item value="general">
          <Accordion.Control>
            <Group gap="xs" align="center">
              <IconSettings size={16} />
              <Text fw={600}>General</Text>
            </Group>
          </Accordion.Control>
          <Accordion.Panel>
            <Stack gap="lg">
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
              {afterTitle}

              <ModelSelect
                label="Shell Model"
                description={desc("shellModel")}
                withAsterisk
                data={sortedLlmModelOptions}
                {...form.getInputProps("shellModel")}
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
                label="Continuity"
                description={desc("continuity")}
                data={[
                  { value: "fresh", label: "Fresh" },
                  { value: "summary", label: "Summary" },
                  { value: "full", label: "Full" },
                ]}
                {...form.getInputProps("continuity")}
              />

              <Textarea
                label="Initial Commands"
                description={`${desc("initialCommands") ?? ""} Separate commands with a blank line.`}
                autosize
                minRows={2}
                spellCheck={false}
                styles={{
                  input: { fontFamily: "monospace", fontSize: "0.875rem" },
                }}
                {...form.getInputProps("initialCommands")}
              />

              {saveDiscardBar}
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>

        <Accordion.Item value="limits">
          <Accordion.Control>
            <Group gap="xs" align="center">
              <IconGauge size={16} />
              <Text fw={600}>Limits</Text>
            </Group>
          </Accordion.Control>
          <Accordion.Panel>
            <Stack gap="lg">
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

              {saveDiscardBar}
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>

        <Accordion.Item value="features">
          <Accordion.Control>
            <Group gap="xs" align="center">
              <IconToggleRight size={16} />
              <Text fw={600}>Features</Text>
            </Group>
          </Accordion.Control>
          <Accordion.Panel>
            <Stack gap="lg">
              <Switch
                label="Chat Enabled"
                description={desc("chatEnabled")}
                {...form.getInputProps("chatEnabled", { type: "checkbox" })}
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
                label="Text Web"
                description={desc("webEnabled")}
                {...form.getInputProps("webEnabled", { type: "checkbox" })}
              />
              <Switch
                label="Headless Browser"
                description={`${desc("browserEnabled") ?? ""} Often blocked for being a bot — use a browser through desktop mode to get around that.`.trim()}
                {...form.getInputProps("browserEnabled", { type: "checkbox" })}
              />
              <Text size="xs" c="dimmed">
                With Text Web or Headless Browser enabled and the GOOGLE_API_KEY
                + GOOGLE_SEARCH_ENGINE_ID env vars set, the agent gets
                ns-websearch — a Google Custom Search command that isn&apos;t
                bot-blocked.
              </Text>
              <Switch
                label="Control Desktop"
                description={desc("controlDesktop")}
                {...form.getInputProps("controlDesktop", { type: "checkbox" })}
              />
              <Switch
                label="Supervisor API Hints"
                description={desc("supervisorApiHints")}
                {...form.getInputProps("supervisorApiHints", {
                  type: "checkbox",
                })}
              />

              {saveDiscardBar}
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>

        <Accordion.Item value="schedules">
          <Accordion.Control>
            <Group gap="xs" align="center">
              <IconClock size={16} />
              <Text fw={600}>Schedules</Text>
              <Text c="dimmed" size="sm">
                ({form.values.schedules.length})
              </Text>
            </Group>
          </Accordion.Control>
          <Accordion.Panel>
            <Stack gap="lg">
              <AgentSchedulesEditor
                schedules={form.values.schedules}
                hubTimezone={hubTimezone}
                onChange={(next) => form.setFieldValue("schedules", next)}
                errors={form.errors as Record<string, React.ReactNode>}
              />
              {saveDiscardBar}
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>

        <Accordion.Item value="hosts">
          <Accordion.Control>
            <Group gap="xs" align="center">
              <IconServer size={16} />
              <Text fw={600}>Assigned Hosts</Text>
              <Text c="dimmed" size="sm">
                ({assignedHosts.length})
              </Text>
            </Group>
          </Accordion.Control>
          <Accordion.Panel>
            <Stack gap="lg">
              <AgentAssignedHostsPanel
                assignedHosts={assignedHosts}
                availableHosts={availableHosts}
                hostActionInProgress={hostActionInProgress}
                onAssignHost={onAssignHost}
                onUnassignHost={onUnassignHost}
              />
              {autoSaveNote}
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>

        <Accordion.Item value="attachments">
          <Accordion.Control>
            <Group gap="xs" align="center">
              <IconPaperclip size={16} />
              <Text fw={600}>Startup Attachments</Text>
              {attachmentCount !== null && (
                <Text c="dimmed" size="sm">
                  ({attachmentCount})
                </Text>
              )}
            </Group>
          </Accordion.Control>
          <Accordion.Panel>
            <Stack gap="lg">
              <AgentStartupAttachments
                username={username}
                onCountChange={setAttachmentCount}
              />
              {autoSaveNote}
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>

        <Accordion.Item value="advanced">
          <Accordion.Control>
            <Group gap="xs" align="center">
              <IconTool size={16} />
              <Text fw={600}>Advanced</Text>
            </Group>
          </Accordion.Control>
          <Accordion.Panel>
            <Stack gap="lg">
              <ModelSelect
                label="Image Model"
                description={desc("imageModel")}
                clearable
                data={imageModelOptions}
                {...form.getInputProps("imageModel")}
              />
              <Switch
                label="Auto Compact"
                description={desc("autoCompact")}
                {...form.getInputProps("autoCompact", { type: "checkbox" })}
              />
              <Switch
                label="Mail Enabled"
                description={`${desc("mailEnabled") ?? ""} The MAIL_ENABLED variable must be set to true as well.`.trim()}
                {...form.getInputProps("mailEnabled", { type: "checkbox" })}
              />
              <Switch
                label="Workspaces Enabled"
                description={desc("workspacesEnabled")}
                {...form.getInputProps("workspacesEnabled", {
                  type: "checkbox",
                })}
              />
              <Switch
                label="Multiple Commands Enabled"
                description={desc("multipleCommandsEnabled")}
                {...form.getInputProps("multipleCommandsEnabled", {
                  type: "checkbox",
                })}
              />
              <Select
                label="Command Protection"
                description={desc("commandProtection")}
                data={[
                  { value: "none", label: "None" },
                  { value: "manual", label: "Manual" },
                  { value: "auto", label: "Auto" },
                ]}
                {...form.getInputProps("commandProtection")}
              />
              <NumberInput
                label="Debug Pause Seconds"
                description={desc("debugPauseSeconds")}
                min={0}
                {...form.getInputProps("debugPauseSeconds")}
              />
              {advancedExtras}
              {saveDiscardBar}
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
    </form>
  );
};
