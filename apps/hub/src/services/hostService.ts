import { isHostOnline } from "@naisys/common";
import { DatabaseService, ulid } from "@naisys/database";
import table from "text-table";

export async function createHostService(
  dbService: DatabaseService,
) {
  async function listHosts(): Promise<string> {
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

  return {
    listHosts,
  };
}

export type HostService = Awaited<ReturnType<typeof createHostService>>;
