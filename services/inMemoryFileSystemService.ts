import { consoleService } from "./consoleService.js";
import { contextService } from "./contextService.js";

interface FileSystemFile {
  name: string;
  parent: FileSystemDirectory;
  content: string;
}

interface FileSystemDirectory {
  name: string;
  parent?: FileSystemDirectory;
  directories: FileSystemDirectory[];
  files?: FileSystemFile[];
}

class InMemoryFileSystem {
  rootDirectory: FileSystemDirectory = {
    name: "",
    directories: [],
    files: [],
  };

  currentDirectory = this.rootDirectory;

  getCurrentPath() {
    let path = "";
    let currentDir: FileSystemDirectory | undefined = this.currentDirectory;
    while (currentDir?.parent) {
      path = currentDir.name + "/" + path;
      currentDir = currentDir.parent;
    }
    return "/" + path;
  }

  handleCommand(line: string, consoleInputLines: string[]) {
    const cmdParams = line.trim().split(" ");

    // Route user to context friendly edit commands that can read/write the entire file in one go
    if (["echo", "nano", "vi", "vim"].includes(cmdParams[0])) {
      contextService.append(
        `${cmdParams[0]} not supported. Use 'cat' to view a file and 'cat > filename << EOF' to write a file`
      );

      return {
        commandHandled: true,
        processNextLine: false,
      };
    }

    let commandHandled = true;
    let processNextLine = false;

    switch (cmdParams[0]) {
      case "mkdir":
        const newDirName = cmdParams[1];
        if (!newDirName) {
          contextService.append("Please enter a directory name");
          break;
        }
        this.currentDirectory.directories.push({
          name: newDirName,
          parent: this.currentDirectory,
          directories: [],
        });
        consoleService.comment(`Directory ${newDirName} created!`);
        processNextLine = true;
        break;

      case "cd":
        const dirName = cmdParams[1];
        if (!dirName) {
          contextService.append("Please enter a directory name");
          break;
        }
        if (dirName === "..") {
          if (this.currentDirectory.parent) {
            this.currentDirectory = this.currentDirectory.parent;
          }
          consoleService.comment(`Directory changed to ${dirName}`);
          processNextLine = true;
          break;
        }

        const newDir = this.currentDirectory.directories.find(
          (dir) => dir.name === dirName
        );
        if (!newDir) {
          contextService.append(`Directory ${dirName} not found`);
          break;
        }
        this.currentDirectory = newDir;
        consoleService.comment(`Directory changed to ${dirName}`);
        processNextLine = true;
        break;

      case "touch":
        const fileName = cmdParams[1];
        if (!fileName) {
          contextService.append("Please enter a file name");
          break;
        }
        this.currentDirectory.files?.push({
          name: fileName,
          parent: this.currentDirectory,
          content: "",
        });
        consoleService.comment(`File ${fileName} created!`);
        processNextLine = true;
        break;

      case "ls":
        contextService.append("Directories: ");
        this.currentDirectory.directories.forEach((dir) =>
          contextService.append(dir.name)
        );
        contextService.append("Files: ");
        this.currentDirectory.files?.forEach((file) =>
          contextService.append(file.name)
        );
        break;

      case "cat":
        // print out the file
        let filename = cmdParams[1];
        if (!filename) {
          contextService.append("Please enter a file name");
          break;
        }

        // write
        if (filename == ">") {
          filename = cmdParams[2];
          if (!filename) {
            contextService.append("Please enter a file name");
            break;
          }
          const catWriteFile = this.currentDirectory.files?.find(
            (file) => file.name === filename
          );
          if (!catWriteFile) {
            contextService.append(`File ${filename} not found`);
            break;
          }
          const catWriteFileContent = consoleInputLines.join("\n");
          catWriteFile.content = catWriteFileContent;
          consoleService.comment(`File ${filename} updated!`);
        } else {
          const catFile = this.currentDirectory.files?.find(
            (file) => file.name === filename
          );
          if (!catFile) {
            contextService.append(`File ${filename} not found`);
            break;
          }
          contextService.append(catFile.content);
        }
        break;

      default:
        commandHandled = false;
        break;
    }

    return {
      commandHandled,
      processNextLine,
    };
  }
}

export const inMemoryFileSystem = new InMemoryFileSystem();
