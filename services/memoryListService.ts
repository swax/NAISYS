/* Much simpler memory model, but may be more lossy if for example a grocery list is stored in a node
more failure prone to new versions the list missing information versus using a more granular tree */

interface MemoryNode {
  title: string;
  value: string;
  loaded: boolean;
  readonly: boolean;
}
const memoryList: MemoryNode[] = [];

export function addMemory(title: string, value: string) {
  memoryList.push({
    title,
    value,
    loaded: true,
    readonly: false,
  });
}

export function deleteMemory(index: number) {
  memoryList.splice(index, 1);
}

export function updateMemory(index: number, value: string) {
  memoryList[index].value = value;
}

export function printMemoryList() {
  return memoryList
    .map((memory, index) => {
      return `${index}: ${memory.title}\n${
        memory.loaded ? memory.value : "Not Loaded"
      }`;
    })
    .join("\n\n");
}
