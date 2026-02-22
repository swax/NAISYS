/**
 * @param abortSignal 5 second mock delay, to simulate network latency and test ESC command
 * @returns Return with a 5 second pause so we can test out of focus agents still waiting before next mock request
 */
export async function sendWithMock(
  abortSignal?: AbortSignal,
): Promise<string[]> {
  await new Promise<void>((resolve, reject) => {
    const timeoutId = setTimeout(resolve, 5000);

    if (abortSignal) {
      if (abortSignal.aborted) {
        clearTimeout(timeoutId);
        reject(abortSignal.reason);
        return;
      }

      abortSignal.addEventListener(
        "abort",
        () => {
          clearTimeout(timeoutId);
          reject(abortSignal.reason);
        },
        { once: true },
      );
    }
  });

  return [
    `ns-comment "Mock LLM ran at ${new Date().toISOString()}"`,
    `ns-session wait 5`,
  ];
}
