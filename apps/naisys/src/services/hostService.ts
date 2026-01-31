import { isHostOnline } from "@naisys/common";
import { DatabaseService, ulid } from "@naisys/database";
import table from "text-table";
import { RegistrableCommand } from "../command/commandRegistry.js";
import { GlobalConfig } from "../globalConfig.js";

export async function createHostService(
  { globalConfig }: GlobalConfig,
  dbService: DatabaseService,
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
        where: { id: existingHost.id },
        data: { last_active: new Date().toISOString() },
      });
      return existingHost.id;
    }

    // Create new host record
    const newHostId = ulid();
    await prisma.hosts.create({
      data: {
        id: newHostId,
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
        where: { id: localHostId },
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
            select: { user_hosts: true },
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
            h.id.slice(-4),
            h.name,
            isHostOnline(h.last_active ?? undefined) ? "Online" : "Offline",
            h._count.user_hosts.toString(),
          ]),
        ],
        { hsep: " | " },
      );
    });
  }

  const registrableCommand: RegistrableCommand = {
    commandName: "ns-hosts",
    helpText: "List all known hosts and their status",
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
