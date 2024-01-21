import "reflect-metadata";
import { Container } from "inversify";
import { CommandLoopService } from "./services/commandLoopService.js";

const container = new Container({
  autoBindInjectable: true,
  defaultScope: "Singleton",
});

container.bind(CommandLoopService).toSelf();

await container.resolve(CommandLoopService).run();

process.exit(0);
