import { hybridFileSystem } from "./hybridFileSystemService.js";
import { sandboxFileSystem } from "./sandboxFileSystemService.js";

interface IFileSystem {
  getName(): string;
  getCurrentPath(): Promise<string>;
  handleCommand(
    line: string,
    consoleInputLines: string[]
  ): Promise<{ commandHandled: boolean; processNextLine: boolean }>;
}

export const fileSystemService: IFileSystem = hybridFileSystem; // sandboxFileSystem; //
