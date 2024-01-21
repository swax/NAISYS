export enum InputMode {
  Debug = "debug",
  LLM = "llm",
}

export let current = InputMode.Debug;

export function toggle(forceMode?: InputMode) {
  if (forceMode) {
    current = forceMode;
  } else if (current == InputMode.Debug) {
    current = InputMode.LLM;
  } else if (current == InputMode.LLM) {
    current = InputMode.Debug;
  }
}
