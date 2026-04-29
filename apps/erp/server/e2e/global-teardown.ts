export default async function globalTeardown() {
  if (!process.env.NODE_V8_COVERAGE) return;

  try {
    const response = await fetch(
      "http://localhost:3302/erp/api/__coverage/flush",
      { method: "POST" },
    );
    if (!response.ok) {
      console.warn(
        `Failed to flush ERP coverage: ${response.status} ${response.statusText}`,
      );
    }
  } catch (err) {
    console.warn(`Failed to flush ERP coverage: ${(err as Error).message}`);
  }
}
