import {
  Alert,
  Button,
  Group,
  Loader,
  Modal,
  Paper,
  Select,
  Stack,
  Switch,
  Text,
  Tooltip as MantineTooltip,
} from "@mantine/core";
import {
  countBy,
  LlmApiType,
  pushToArrayMap,
  sortByDesc,
} from "@naisys/common";
import { IconExclamationCircle } from "@tabler/icons-react";
import type { ChartData, ChartOptions } from "chart.js";
import React, { useEffect, useMemo, useState } from "react";
import { Scatter } from "react-chartjs-2";
import { useNavigate } from "react-router-dom";

import {
  api,
  apiEndpoints,
  type OpenRouterCatalogResponse,
} from "../../lib/api/apiClient";
import { saveLlmModel } from "../../lib/api/apiModels";
import { AGENT_COLOR_TOKENS, useColorResolver } from "../../lib/charts";

type CatalogModel = OpenRouterCatalogResponse["models"][number];

interface AddOpenRouterModelDialogProps {
  opened: boolean;
  onClose: () => void;
  onAdded: () => Promise<void> | void;
  canSave: boolean;
}

/** Log axes can't render 0 — clamp to a value below any real OpenRouter price. */
const PRICE_EPSILON = 0.001;

export const AddOpenRouterModelDialog: React.FC<
  AddOpenRouterModelDialogProps
> = ({ opened, onClose, onAdded, canSave }) => {
  const navigate = useNavigate();
  const resolveColor = useColorResolver();
  const [models, setModels] = useState<CatalogModel[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [freeOnly, setFreeOnly] = useState(false);

  const isFree = (m: CatalogModel) => m.inputCost === 0 && m.outputCost === 0;

  useEffect(() => {
    if (!opened || models) return;
    let cancelled = false;
    setLoadError(null);
    api
      .get<OpenRouterCatalogResponse>(apiEndpoints.openRouterCatalog)
      .then((data) => {
        if (cancelled) return;
        setModels(data.models);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [opened, models]);

  const options = useMemo(() => {
    if (!models) return [];
    // Newest first — most users want to find a recently-released model.
    return sortByDesc(
      models.filter((m) => (freeOnly ? isFree(m) : true)),
      (m) => m.created,
    ).map((m) => ({ value: m.id, label: `${m.name} (${m.id})` }));
  }, [models, freeOnly]);

  const formatCreated = (unixSeconds: number | undefined): string => {
    if (!unixSeconds) return "unknown";
    return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
  };

  const selected = useMemo(
    () => models?.find((m) => m.id === selectedId),
    [models, selectedId],
  );

  /**
   * Top N most-common providers get their own color; the rest are grouped as "other".
   * Limit chosen to fit the color palette without collisions.
   */
  const MAX_NAMED_PROVIDERS = AGENT_COLOR_TOKENS.length - 1;

  const groupedModels = useMemo(() => {
    if (!models) return [];
    // Free models cluster at the epsilon clamp and crowd the chart — exclude them.
    const paid = models.filter((m) => !isFree(m));
    const counts = countBy(paid, (m) => m.provider);
    const ranked = sortByDesc(counts.entries(), ([, count]) => count).map(
      ([provider]) => provider,
    );
    const named = new Set(ranked.slice(0, MAX_NAMED_PROVIDERS));
    const buckets = new Map<string, CatalogModel[]>();
    for (const m of paid) {
      const key = named.has(m.provider) ? m.provider : "other";
      pushToArrayMap(buckets, key, m);
    }
    // Preserve ranked order; "other" goes last.
    const order = [
      ...ranked.filter((p) => named.has(p)),
      ...(buckets.has("other") ? ["other"] : []),
    ];
    return order.map((provider) => ({
      provider,
      models: buckets.get(provider) ?? [],
    }));
  }, [models, MAX_NAMED_PROVIDERS]);

  const freeCount = useMemo(
    () => (models ? models.filter(isFree).length : 0),
    [models],
  );

  const chartData = useMemo<ChartData<"scatter">>(() => {
    if (groupedModels.length === 0) return { datasets: [] };
    return {
      datasets: groupedModels.map((g, gIdx) => {
        const color = resolveColor(
          AGENT_COLOR_TOKENS[gIdx % AGENT_COLOR_TOKENS.length],
        );
        return {
          label: g.provider,
          data: g.models.map((m) => ({
            x: Math.max(m.inputCost, PRICE_EPSILON),
            y: Math.max(m.outputCost, PRICE_EPSILON),
          })),
          backgroundColor: color,
          borderColor: g.models.map((m) =>
            m.id === selectedId ? "#ffffff" : color,
          ),
          borderWidth: g.models.map((m) => (m.id === selectedId ? 2 : 1)),
          pointRadius: g.models.map((m) => (m.id === selectedId ? 9 : 3)),
          pointHoverRadius: 7,
        };
      }),
    };
  }, [groupedModels, selectedId, resolveColor]);

  const chartOptions = useMemo<ChartOptions<"scatter">>(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: {
          display: true,
          position: "right",
          labels: { boxWidth: 12, font: { size: 11 } },
        },
        tooltip: {
          callbacks: {
            title: (items) => {
              const item = items[0];
              if (!item) return "";
              const m =
                groupedModels[item.datasetIndex]?.models[item.dataIndex];
              return m ? `${m.name} (${m.id})` : "";
            },
            label: (ctx) => {
              const m = groupedModels[ctx.datasetIndex]?.models[ctx.dataIndex];
              if (!m) return "";
              return `Input: $${m.inputCost.toFixed(4)}/1M · Output: $${m.outputCost.toFixed(4)}/1M`;
            },
          },
        },
      },
      scales: {
        x: {
          type: "logarithmic",
          title: { display: true, text: "Input cost ($/1M tokens, log)" },
          ticks: { callback: (v) => `$${Number(v).toFixed(3)}` },
        },
        y: {
          type: "logarithmic",
          title: { display: true, text: "Output cost ($/1M tokens, log)" },
          ticks: { callback: (v) => `$${Number(v).toFixed(3)}` },
        },
      },
      onClick: (_evt, elements) => {
        if (elements.length === 0) return;
        const el = elements[0];
        const m = groupedModels[el.datasetIndex]?.models[el.index];
        if (m) setSelectedId(m.id);
      },
    }),
    [groupedModels],
  );

  const handleClose = () => {
    setSelectedId(null);
    setSaveError(null);
    onClose();
  };

  const handleAdd = async () => {
    if (!selected) return;
    setSaving(true);
    setSaveError(null);
    try {
      // Use the slug after the provider prefix (e.g. "anthropic/claude-opus-4.7" → "claude-opus-4.7").
      // If there's no slash, fall back to the full id.
      const slashIdx = selected.id.indexOf("/");
      const key = slashIdx >= 0 ? selected.id.slice(slashIdx + 1) : selected.id;

      const model: Record<string, unknown> = {
        key,
        label: selected.name,
        versionName: selected.id,
        apiType: LlmApiType.OpenAICompatible,
        maxTokens: selected.contextLength ?? 128_000,
        baseUrl: "https://openrouter.ai/api/v1",
        apiKeyVar: "OPENROUTER_API_KEY",
        inputCost: selected.inputCost,
        outputCost: selected.outputCost,
      };
      if (selected.cacheReadCost !== undefined)
        model.cacheReadCost = selected.cacheReadCost;
      if (selected.cacheWriteCost !== undefined)
        model.cacheWriteCost = selected.cacheWriteCost;
      if (selected.supportsToolUse) model.supportsToolUse = true;
      if (selected.supportsVision) model.supportsVision = true;
      if (selected.supportsHearing) model.supportsHearing = true;

      const result = await saveLlmModel(model);
      if (!result.success) {
        setSaveError(result.message || "Failed to save model");
        return;
      }
      await onAdded();
      handleClose();
      void navigate(`/models/${encodeURIComponent(key)}`);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      title="Add OpenRouter Model"
      centered
      size="xl"
    >
      <Stack gap="md">
        {!models && !loadError && (
          <Group justify="center" gap="xs">
            <Loader size="sm" />
            <Text size="sm">Loading models from OpenRouter…</Text>
          </Group>
        )}
        {loadError && (
          <Alert color="red" icon={<IconExclamationCircle size={16} />}>
            Failed to load OpenRouter models: {loadError}
          </Alert>
        )}
        {models && models.length > 0 && (
          <Paper p="md" withBorder>
            <Text size="sm" fw={500} mb="sm">
              Input vs. Output Cost — click a point to select
            </Text>
            <div style={{ height: 320 }}>
              <Scatter data={chartData} options={chartOptions} />
            </div>
            <Text size="xs" c="dimmed" mt={4}>
              {freeCount} free model{freeCount === 1 ? "" : "s"} hidden — toggle
              "Free only" below to browse them.
            </Text>
          </Paper>
        )}
        {models && (
          <Stack gap="xs">
            <Group justify="space-between" align="flex-end">
              <Text size="sm" fw={500}>
                Or pick from the full list
              </Text>
              <Switch
                size="xs"
                label="Free only"
                checked={freeOnly}
                onChange={(e) => setFreeOnly(e.currentTarget.checked)}
                disabled={saving}
              />
            </Group>
            <Select
              description={
                freeOnly
                  ? `Showing ${freeCount} free model${freeCount === 1 ? "" : "s"} (newest first)`
                  : "Search by name / id (newest first)"
              }
              placeholder="Search models…"
              data={options}
              value={selectedId}
              onChange={setSelectedId}
              searchable
              limit={50}
              disabled={saving}
              withAsterisk
            />
          </Stack>
        )}
        {selected && (
          <Stack gap={4}>
            <Text size="xs" c="dimmed">
              Added to OpenRouter: {formatCreated(selected.created)}
            </Text>
            <Text size="xs" c="dimmed">
              Context: {selected.contextLength?.toLocaleString() ?? "?"} tokens
            </Text>
            <Text size="xs" c="dimmed">
              Input: ${selected.inputCost.toFixed(4)} / 1M tokens · Output: $
              {selected.outputCost.toFixed(4)} / 1M tokens
            </Text>
            <Text size="xs" c="dimmed">
              Requires <code>OPENROUTER_API_KEY</code> in your environment.
            </Text>
          </Stack>
        )}
        {saveError && (
          <Alert color="red" icon={<IconExclamationCircle size={16} />}>
            {saveError}
          </Alert>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={handleClose} disabled={saving}>
            Cancel
          </Button>
          <MantineTooltip
            label="You don't have permission to add models"
            disabled={canSave}
          >
            <Button
              onClick={handleAdd}
              loading={saving}
              disabled={!selected || saving || !canSave}
              data-disabled={!canSave ? true : undefined}
            >
              Add
            </Button>
          </MantineTooltip>
        </Group>
      </Stack>
    </Modal>
  );
};
