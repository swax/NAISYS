import { ulid } from "@naisys/database";
import { DatabaseService } from "@naisys/database";
import { GlobalConfig } from "../globalConfig.js";

export async function createHostService(
  { globalConfig }: GlobalConfig,
  dbService: DatabaseService
) {
  const localHostname = globalConfig().hostname;

  let updateInterval: NodeJS.Timeout | null = null;

  // Create or get the host record
  const localHostId = await dbService.usingDatabase(async (prisma) => {
    // Try to find existing host by name
    const existingHost = await prisma.hosts.findUnique({
      where: { name: localHostname },
    });

    if (existingHost) {
      // Update last_active timestamp
      await prisma.hosts.update({
        where: { host_id: existingHost.host_id },
        data: { last_active: new Date().toISOString() },
      });
      return existingHost.host_id;
    }

    // Create new host record
    const newHostId = ulid();
    await prisma.hosts.create({
      data: {
        host_id: newHostId,
        name: localHostname,
        last_active: new Date().toISOString(),
      },
    });

    console.log(`Created host record: ${localHostname} (${newHostId})`);
    return newHostId;
  });

  async function updateLastActive(): Promise<void> {
    await dbService.usingDatabase(async (prisma) => {
      await prisma.hosts.update({
        where: { host_id: localHostId },
        data: { last_active: new Date().toISOString() },
      });
    });
  }

  // Start periodic last_active updates
  updateInterval = setInterval(updateLastActive, 2000);

  function cleanup() {
    if (updateInterval) {
      clearInterval(updateInterval);
      updateInterval = null;
    }
  }

  return {
    cleanup,
    localHostId,
    localHostname,
  };
}

export type HostService = Awaited<ReturnType<typeof createHostService>>;
