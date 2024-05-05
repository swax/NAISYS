/**
 * Iterate all yaml files in the fine-tuning directory and generate a jsonl file
 *
 * YAML Format:
 * - example:
 *     - system: ...
 *     - naisys: ...
 *     - llm: ...
 *     - naisys: ...
 *
 * (naisys is the user role, and llm is the assistant role)
 *
 * JSONL Format:
 * {"messages": ["role": "system", "content": "..."}, {"role": "user", "content": "..."}, {"role": "assistant", "content": "..."}]}
 */

import fs from "fs";
import yaml from "js-yaml";
import path from "path";

// Iterate all yaml files in the fine-tuning directory
const directory = "./fine-tuning";
const filenames = fs
  .readdirSync(directory)
  .filter((file) => file.endsWith(".yaml"));

const outputDirectory = "./fine-tuning/jsonl";
if (!fs.existsSync(outputDirectory)) {
  fs.mkdirSync(outputDirectory);
}

for (const filename of filenames) {
  const filePath = path.join(directory, filename);
  console.log(`Reading ${filePath}...`);

  const content = fs.readFileSync(filePath, "utf-8");
  const dataset = yaml.load(content) as {
    example: { system: string; naisys: string; llm: string }[];
  }[];

  // Write as a jsonl file to the jsonl directory
  const jsonlFilename = filename.replace(".yaml", ".jsonl");
  const jsonlPath = path.join(outputDirectory, jsonlFilename);
  console.log(`Writing ${jsonlPath}...`);

  const jsonlStream = fs.createWriteStream(jsonlPath);

  let index = 1;
  for (const { example } of dataset) {
    console.log(`  Example ${index++}...`);
    const messages = example.map(({ system, naisys, llm }) => {
      if (system) {
        return {
          role: "system",
          content: system,
        };
      } else if (naisys) {
        return {
          role: "user",
          content: naisys,
        };
      } else if (llm) {
        return {
          role: "assistant",
          content: llm,
        };
      } else {
        throw "Error: Invalid role";
      }
    });

    jsonlStream.write(JSON.stringify({ messages }) + "\n");
  }

  jsonlStream.close();
}

console.log("All files processed.");
