import { ulid } from "@naisys/database";
import { DatabaseService } from "@naisys/database";
import { GlobalConfig } from "../globalConfig.js";

export async function createHostService(
  { globalConfig }: GlobalConfig,
  dbService: DatabaseService
) {
  const localHostname = globalConfig().hostname;

  // Create or get the host record
  const localHostId = await dbService.usingDatabase(async (prisma) => {
    // Try to find existing host by name
    const existingHost = await prisma.hosts.findUnique({
      where: { name: localHostname },
    });

    if (existingHost) {
      // Touch the host record to update updated_at
      await prisma.hosts.update({
        where: { host_id: existingHost.host_id },
        data: {}, // Empty update triggers @updatedAt
      });
      return existingHost.host_id;
    }

    // Create new host record
    const newHostId = ulid();
    await prisma.hosts.create({
      data: {
        host_id: newHostId,
        name: localHostname,
      },
    });

    console.log(`Created host record: ${localHostname} (${newHostId})`);
    return newHostId;
  });

  return {
    localHostId,
    localHostname,
  };
}

export type HostService = Awaited<ReturnType<typeof createHostService>>;
