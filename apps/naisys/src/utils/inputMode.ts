enum InputMode {
  Debug = "debug",
  LLM = "llm",
}

export function createInputMode() {
  let inputMode = InputMode.Debug;

  function setLLM() {
    inputMode = InputMode.LLM;
  }

  function setDebug() {
    inputMode = InputMode.Debug;
  }

  function isLLM() {
    return inputMode === InputMode.LLM;
  }

  function isDebug() {
    return inputMode === InputMode.Debug;
  }

  return {
    setLLM,
    setDebug,
    isLLM,
    isDebug,
  };
}

export type InputModeService = ReturnType<typeof createInputMode>;
