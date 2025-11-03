import { expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

test("all files in bin folder have LF line endings", () => {
  const url = new URL("../../bin", import.meta.url);
  const binPath = fileURLToPath(url);
  const files = fs.readdirSync(binPath);
  for (const file of files) {
    const filePath = path.join(binPath, file);
    const fileContents = fs.readFileSync(filePath, "utf8");
    const hasCrlf = fileContents.includes("\r\n");

    if (hasCrlf) {
      console.error("Invalid CRLF File: ", file);
    }
    expect(hasCrlf).toBe(false);
  }
});
