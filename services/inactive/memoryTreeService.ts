/* The memory tree is like a stack, but a tree allowing leaves to be pushed and branches to be popped 

more complicated, and get confusing with lots of ids.

also for multiline data we really need to tab in all the data to be aligned 
with the leaf which is more complicated versus a flatlist */

interface MemoryNode {
  id: number;
  value: string;
  loaded: boolean;
  parent?: MemoryNode;
  children: MemoryNode[];
}

export const rootId = 1;

const memoryTree: MemoryNode = {
  id: rootId,
  loaded: true,
  value: "root",
  children: [],
};

const memoryMap = new Map<number, MemoryNode>();
memoryMap.set(1, memoryTree);

let nextId = rootId + 1;
let focusId = 0;

export function addMemoryLeaf(id: number, memory: string) {
  const parent = memoryMap.get(id);
  if (!parent) {
    throw new Error(`Could not find parent with id ${id}`);
  }

  const leaf: MemoryNode = {
    id: nextId,
    value: memory,
    loaded: true,
    parent: parent,
    children: [],
  };

  parent.children.push(leaf);
  memoryMap.set(nextId, leaf);
  nextId++;

  return leaf.id;
}

export function memoryTreeToString() {
  return recursiveTreeToString(memoryTree, 0);
}

export function deleteMemoryBranch(id: number) {
  const node = memoryMap.get(id);

  if (!node) {
    throw new Error(`Could not find node with id ${id}`);
  }

  if (!node.parent) {
    throw new Error(`Unable to delete root node`);
  }

  node.parent.children = node.parent.children.filter(
    (child) => child.id !== node.id
  );

  cleanMemoryMap(id);
}

export function updateMemory(id: number, memory: string) {
  const node = memoryMap.get(id);
  if (!node) {
    throw new Error(`Could not find node with id ${id}`);
  }

  node.value = memory;
}

export function toggleMemory(id: number) {
  const node = memoryMap.get(id);
  if (!node) {
    throw new Error(`Could not find node with id ${id}`);
  }

  node.loaded = !node.loaded;
}

function cleanMemoryMap(id: number) {
  const node = memoryMap.get(id);
  if (!node) {
    throw new Error(`Could not find node with id ${id}`);
  }

  for (const child of node.children) {
    cleanMemoryMap(child.id);
    memoryMap.delete(child.id);
  }
}

function recursiveTreeToString(node: MemoryNode, depth: number) {
  let treeString = `${"\t".repeat(depth)}${node.id}. ${node.value}\n`;
  for (const child of node.children) {
    if (child.loaded) {
      treeString += recursiveTreeToString(child, depth + 1);
    } else {
      treeString += `${"\t".repeat(depth + 1)}${
        child.id
      }. ${child.value.substring(16)}... (Unloaded)\n`;
    }
  }
  return treeString;
}
