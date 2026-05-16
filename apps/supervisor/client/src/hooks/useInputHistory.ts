import { useCallback, useEffect, useRef } from "react";

interface UseInputHistoryOptions {
  /** Unique key per (sender, target) so histories don't leak across contexts. Null disables history. */
  storageKey: string | null;
  value: string;
  onValueChange: (value: string) => void;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  maxEntries?: number;
}

interface UseInputHistoryResult {
  /** Call after a successful send to record the entry. No-op for blank input or null storageKey. */
  pushHistory: (entry: string) => void;
  /** Compose into the input's onKeyDown — calls preventDefault when it navigates. */
  handleKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
}

const DEFAULT_MAX = 100;
const STORAGE_PREFIX = "naisys:input-history:";

interface InputHistoryNavState {
  index: number;
  draft: string;
}

interface InputHistoryNavParams {
  key: "ArrowUp" | "ArrowDown";
  history: string[];
  value: string;
  selectionStart: number;
  state: InputHistoryNavState;
}

interface InputHistoryNavResult {
  preventDefault: boolean;
  state: InputHistoryNavState;
  value?: string;
}

export function appendInputHistory(
  history: string[],
  entry: string,
  maxEntries = DEFAULT_MAX,
): string[] {
  const trimmed = entry.trim();
  if (!trimmed) return history;
  if (history[history.length - 1] === trimmed) return history;
  return [...history, trimmed].slice(-maxEntries);
}

export function navigateInputHistory({
  key,
  history,
  value,
  selectionStart,
  state,
}: InputHistoryNavParams): InputHistoryNavResult {
  if (history.length === 0) return { preventDefault: false, state };

  const onFirstLine = !value.slice(0, selectionStart).includes("\n");
  const onLastLine = !value.slice(selectionStart).includes("\n");

  if (key === "ArrowUp") {
    if (!onFirstLine) return { preventDefault: false, state };
    if (state.index === 0) return { preventDefault: true, state };

    if (state.index === -1) {
      const nextIndex = history.length - 1;
      return {
        preventDefault: true,
        state: { index: nextIndex, draft: value },
        value: history[nextIndex],
      };
    }

    const nextIndex = state.index - 1;
    return {
      preventDefault: true,
      state: { ...state, index: nextIndex },
      value: history[nextIndex],
    };
  }

  if (!onLastLine) return { preventDefault: false, state };
  if (state.index === -1) return { preventDefault: false, state };

  if (state.index < history.length - 1) {
    const nextIndex = state.index + 1;
    return {
      preventDefault: true,
      state: { ...state, index: nextIndex },
      value: history[nextIndex],
    };
  }

  return {
    preventDefault: true,
    state: { index: -1, draft: state.draft },
    value: state.draft,
  };
}

function loadHistory(key: string): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === "string")
      : [];
  } catch {
    return [];
  }
}

function saveHistory(key: string, entries: string[]): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(entries));
  } catch {
    // quota exceeded, private mode, etc — silently ignore
  }
}

export function useInputHistory({
  storageKey,
  value,
  onValueChange,
  inputRef,
  maxEntries = DEFAULT_MAX,
}: UseInputHistoryOptions): UseInputHistoryResult {
  const historyRef = useRef<string[]>([]);
  // -1 means "not navigating"; otherwise an index into historyRef.current
  const indexRef = useRef<number>(-1);
  // Draft preserved when entering history mode, restored when arrowing past the newest entry
  const draftRef = useRef<string>("");
  // Tracks the value we wrote so we can distinguish user typing from our own writes
  const lastSetValueRef = useRef<string | null>(null);

  // Reload history and reset nav state when the context changes
  useEffect(() => {
    historyRef.current = storageKey ? loadHistory(storageKey) : [];
    indexRef.current = -1;
    draftRef.current = "";
    lastSetValueRef.current = null;
  }, [storageKey]);

  // Any value change that didn't come from us (i.e., the user typed or pasted) exits history mode
  useEffect(() => {
    if (indexRef.current === -1) return;
    if (lastSetValueRef.current !== null && value === lastSetValueRef.current) {
      return;
    }
    indexRef.current = -1;
    draftRef.current = "";
    lastSetValueRef.current = null;
  }, [value]);

  const setValueAt = useCallback(
    (newValue: string) => {
      lastSetValueRef.current = newValue;
      onValueChange(newValue);
      // React commits the value before the next paint; rAF puts us after the commit
      // so setSelectionRange operates on the updated DOM text.
      requestAnimationFrame(() => {
        const input = inputRef.current;
        if (!input) return;
        const pos = newValue.length;
        input.setSelectionRange(pos, pos);
      });
    },
    [onValueChange, inputRef],
  );

  const pushHistory = useCallback(
    (entry: string) => {
      const trimmed = entry.trim();
      indexRef.current = -1;
      draftRef.current = "";
      lastSetValueRef.current = null;
      if (!trimmed || !storageKey) return;
      const history = historyRef.current;
      const next = appendInputHistory(history, trimmed, maxEntries);
      if (next === history) return;
      historyRef.current = next;
      saveHistory(storageKey, next);
    },
    [storageKey, maxEntries],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const input = inputRef.current;
      if (!input) return;
      const history = historyRef.current;

      const selStart = input.selectionStart ?? 0;
      const result = navigateInputHistory({
        key: e.key,
        history,
        value,
        selectionStart: selStart,
        state: { index: indexRef.current, draft: draftRef.current },
      });

      if (!result.preventDefault) return;
      e.preventDefault();
      indexRef.current = result.state.index;
      draftRef.current = result.state.draft;
      if (result.value !== undefined) setValueAt(result.value);
    },
    [value, inputRef, setValueAt],
  );

  return { pushHistory, handleKeyDown };
}
