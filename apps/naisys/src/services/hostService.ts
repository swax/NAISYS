import { isHostOnline } from "@naisys/common";
import { ulid } from "@naisys/database";
import { DatabaseService } from "@naisys/database";
import table from "text-table";
import { RegistrableCommand } from "../command/commandRegistry.js";
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

  async function handleCommand(): Promise<string> {
    return await dbService.usingDatabase(async (prisma) => {
      const hosts = await prisma.hosts.findMany({
        include: {
          _count: {
            select: { users: { where: { deleted_at: null } } },
          },
        },
        orderBy: { name: "asc" },
      });

      if (hosts.length === 0) {
        return "No hosts found.";
      }

      return table(
        [
          ["ID", "Name", "Status", "Agents"],
          ...hosts.map((h) => [
            h.host_id.slice(-4),
            h.name,
            isHostOnline(h.last_active ?? undefined) ? "Online" : "Offline",
            h._count.users.toString(),
          ]),
        ],
        { hsep: " | " }
      );
    });
  }

  const registrableCommand: RegistrableCommand = {
    commandName: "ns-hosts",
    handleCommand,
  };

  return {
    ...registrableCommand,
    cleanup,
    localHostId,
    localHostname,
  };
}

export type HostService = Awaited<ReturnType<typeof createHostService>>;
