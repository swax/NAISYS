import {
  ActionIcon,
  Anchor,
  Button,
  Group,
  Select,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
} from "@mantine/core";
import type { ScheduleEntry } from "@naisys/common";
import { nextFireAt, validateCron } from "@naisys/common";
import { IconPlus, IconTrash } from "@tabler/icons-react";
import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

interface AgentSchedulesEditorProps {
  schedules: ScheduleEntry[];
  /** Hub TZ so previews match the scheduler's actual fire time. */
  hubTimezone: string;
  /** Agents selectable as a schedule's initiator (the fire message sender). */
  initiatorOptions: { value: string; label: string }[];
  onChange: (next: ScheduleEntry[]) => void;
  /** Per-entry-name validation errors keyed like `"schedules.0.name"`. */
  errors?: Record<string, React.ReactNode>;
}

const CUSTOM = "__custom__";

const PRESETS: { value: string; label: string }[] = [
  { value: "0 * * * *", label: "Every hour (top of the hour)" },
  { value: "*/15 * * * *", label: "Every 15 minutes" },
  { value: "0 9 * * *", label: "Daily at 9:00 AM" },
  { value: "0 9 * * 1-5", label: "Weekdays at 9:00 AM" },
  { value: "0 18 * * 0", label: "Sundays at 6:00 PM" },
];

const PRESET_EXPRESSIONS = new Set(PRESETS.map((p) => p.value));

function formatRelative(target: Date, now: Date): string {
  const ms = target.getTime() - now.getTime();
  if (ms < 0) return "now";
  const s = Math.round(ms / 1000);
  if (s < 60) return `in ${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `in ${m}m`;
  const h = Math.round(m / 60);
  if (h < 48) return `in ${h}h`;
  const d = Math.round(h / 24);
  return `in ${d}d`;
}

/** Show hub-TZ time alongside browser-local when they differ so the cron
 *  the user just typed in hub-TZ frame matches the preview wall clock. */
function formatHubAndLocal(date: Date, hubTimezone: string): string {
  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (browserTz === hubTimezone) return date.toLocaleString();
  const hub = date.toLocaleString(undefined, { timeZone: hubTimezone });
  return `${hub} (hub) / ${date.toLocaleString()} (local)`;
}

/** Extracted so preset state is per-row, not flat in the parent. */
const ScheduleRow: React.FC<{
  entry: ScheduleEntry;
  index: number;
  hubTimezone: string;
  initiatorOptions: { value: string; label: string }[];
  errors: Record<string, React.ReactNode>;
  onChange: (next: ScheduleEntry) => void;
  onDelete: () => void;
}> = ({
  entry,
  index,
  hubTimezone,
  initiatorOptions,
  errors,
  onChange,
  onDelete,
}) => {
  const initialPreset = PRESET_EXPRESSIONS.has(entry.cron)
    ? entry.cron
    : CUSTOM;
  const [presetValue, setPresetValue] = useState<string>(initialPreset);

  // Resync when cron changes externally (form reset).
  useEffect(() => {
    setPresetValue(PRESET_EXPRESSIONS.has(entry.cron) ? entry.cron : CUSTOM);
  }, [entry.cron]);

  const cronValidation = useMemo(() => validateCron(entry.cron), [entry.cron]);

  const next = useMemo(() => {
    if (!cronValidation.ok || entry.enabled === false) return null;
    return nextFireAt(entry.cron, new Date(), hubTimezone);
  }, [entry.cron, entry.enabled, cronValidation.ok, hubTimezone]);

  const previewLine = useMemo(() => {
    if (entry.enabled === false) return "Disabled — will not fire";
    if (!cronValidation.ok) return cronValidation.error;
    if (!next) return "No upcoming fire";
    return `Next fire: ${formatHubAndLocal(next, hubTimezone)} (${formatRelative(next, new Date())})`;
  }, [entry.enabled, cronValidation, next, hubTimezone]);

  const handlePresetChange = (value: string | null) => {
    const v = value ?? CUSTOM;
    setPresetValue(v);
    if (v !== CUSTOM) onChange({ ...entry, cron: v });
  };

  // Keep a stored initiator visible even if it's no longer a selectable
  // option (e.g. that agent was archived or renamed).
  const initiatorData = useMemo(() => {
    if (
      entry.initiator &&
      !initiatorOptions.some((o) => o.value === entry.initiator)
    ) {
      return [
        { value: entry.initiator, label: `${entry.initiator} (unavailable)` },
        ...initiatorOptions,
      ];
    }
    return initiatorOptions;
  }, [entry.initiator, initiatorOptions]);

  return (
    <Stack
      gap="xs"
      p="sm"
      style={{
        border: "1px solid var(--mantine-color-default-border)",
        borderRadius: 6,
      }}
    >
      <Group gap="xs" align="flex-start" wrap="nowrap">
        <TextInput
          label="Name"
          placeholder="morning-triage"
          value={entry.name}
          onChange={(e) => onChange({ ...entry, name: e.currentTarget.value })}
          error={errors[`schedules.${index}.name`]}
          style={{ flex: 1 }}
        />
        <Switch
          label="Enabled"
          checked={entry.enabled !== false}
          onChange={(e) =>
            onChange({ ...entry, enabled: e.currentTarget.checked })
          }
          mt={28}
        />
        <ActionIcon
          color="red"
          variant="subtle"
          onClick={onDelete}
          title="Delete schedule"
          mt={30}
        >
          <IconTrash size={16} />
        </ActionIcon>
      </Group>

      <Group gap="xs" align="flex-start" wrap="nowrap">
        <Select
          label="Preset"
          data={[...PRESETS, { value: CUSTOM, label: "Custom (cron)" }]}
          value={presetValue}
          onChange={handlePresetChange}
          style={{ flex: 1 }}
        />
        <TextInput
          label="Cron expression"
          placeholder="0 9 * * 1-5"
          value={entry.cron}
          onChange={(e) => onChange({ ...entry, cron: e.currentTarget.value })}
          error={
            errors[`schedules.${index}.cron`] ??
            (!cronValidation.ok ? cronValidation.error : undefined)
          }
          styles={{ input: { fontFamily: "monospace" } }}
          style={{ flex: 1 }}
        />
      </Group>

      <Textarea
        label="Prompt"
        description="Sent to the agent as a chat from the initiator when this schedule fires. Falls back to the schedule name when empty."
        placeholder="Check overnight builds and triage any failures."
        value={entry.prompt ?? ""}
        onChange={(e) =>
          onChange({
            ...entry,
            prompt: e.currentTarget.value || undefined,
          })
        }
        autosize
        minRows={2}
      />

      <Select
        label="Initiator"
        description="Who the fire message comes from. The agent reports back to this user when done, so that agent can run its own post-processing. Defaults to the agent's lead, or admin if it has no lead."
        placeholder="Lead agent, or admin (default)"
        data={initiatorData}
        value={entry.initiator ?? null}
        onChange={(value) =>
          onChange({ ...entry, initiator: value || undefined })
        }
        clearable
        searchable
      />

      <Text size="xs" c={cronValidation.ok ? "dimmed" : "red"}>
        {previewLine}
      </Text>
    </Stack>
  );
};

export const AgentSchedulesEditor: React.FC<AgentSchedulesEditorProps> = ({
  schedules,
  hubTimezone,
  initiatorOptions,
  onChange,
  errors = {},
}) => {
  const handleAdd = () => {
    onChange([
      ...schedules,
      { name: "", cron: "0 9 * * *", enabled: true, prompt: undefined },
    ]);
  };

  const handleRowChange = (index: number, next: ScheduleEntry) => {
    const copy = [...schedules];
    copy[index] = next;
    onChange(copy);
  };

  const handleRowDelete = (index: number) => {
    onChange(schedules.filter((_, i) => i !== index));
  };

  return (
    <Stack gap="sm">
      <Group justify="space-between" align="center">
        <Text fw={600} size="sm" c="dimmed">
          Schedules
        </Text>
        <Button
          size="compact-sm"
          variant="light"
          leftSection={<IconPlus size={14} />}
          onClick={handleAdd}
        >
          Add schedule
        </Button>
      </Group>
      <Text size="xs" c="dimmed">
        Cron evaluates in the hub&apos;s timezone ({hubTimezone}) — set the{" "}
        <Anchor component={Link} to="/variables" inherit>
          TIMEZONE variable
        </Anchor>{" "}
        to override it. On fire, the agent gets a chat from the initiator (its
        lead, or admin, by default) and is started if not running. Its reply
        goes back to the initiator, who can then run their own post-processing.
      </Text>
      {schedules.length === 0 ? (
        <Text size="sm" c="dimmed">
          No schedules configured.
        </Text>
      ) : (
        schedules.map((entry, i) => (
          <ScheduleRow
            key={i}
            entry={entry}
            index={i}
            hubTimezone={hubTimezone}
            initiatorOptions={initiatorOptions}
            errors={errors}
            onChange={(next) => handleRowChange(i, next)}
            onDelete={() => handleRowDelete(i)}
          />
        ))
      )}
    </Stack>
  );
};
