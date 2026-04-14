import fs from "fs";
import readline from "readline";
import { fileURLToPath } from "url";

export interface WizardField {
  key: string;
  label: string;
  /** Override default from .env.example (e.g. runtime-computed values like os.hostname()) */
  defaultValue?: string;
}

export interface WizardProviderOption {
  name: string;
  fields: WizardField[];
}

export interface WizardFieldSection {
  type: "fields";
  comment?: string;
  fields: WizardField[];
}

export interface WizardProviderSection {
  type: "providers";
  comment?: string;
  label: string;
  options: WizardProviderOption[];
}

export type WizardSection = WizardFieldSection | WizardProviderSection;

export interface WizardConfig {
  title: string;
  sections: WizardSection[];
}

/** Parse a .env file into key-value pairs */
function parseEnvFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) return {};
  const content = fs.readFileSync(filePath, "utf-8");
  const result: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.substring(0, eqIdx).trim();
    let value = trimmed.substring(eqIdx + 1).trim();
    // Remove surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    // Remove inline comments (only for unquoted values)
    else {
      const hashIdx = value.indexOf(" #");
      if (hashIdx !== -1) value = value.substring(0, hashIdx).trim();
    }
    result[key] = value;
  }
  return result;
}

/** Get all field keys defined in the wizard config */
function getWizardKeys(config: WizardConfig): Set<string> {
  const keys = new Set<string>();
  for (const section of config.sections) {
    if (section.type === "fields") {
      for (const field of section.fields) keys.add(field.key);
    } else {
      for (const opt of section.options) {
        for (const field of opt.fields) keys.add(field.key);
      }
    }
  }
  return keys;
}

/**
 * Run an interactive setup wizard that prompts the user for configuration values
 * and writes a .env file. Defaults are sourced from the .env.example file,
 * then overridden by any existing .env values.
 */
export async function runSetupWizard(
  dotenvPath: string,
  exampleUrl: URL,
  config: WizardConfig,
): Promise<void> {
  if (!process.stdin.isTTY) {
    console.log("\n  Setup wizard requires an interactive terminal.\n");
    process.exit(1);
  }

  const exampleValues = parseEnvFile(fileURLToPath(exampleUrl));
  const existingValues = parseEnvFile(dotenvPath);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = (prompt: string): Promise<string> =>
    new Promise((resolve) => rl.question(prompt, resolve));

  const results: Record<string, string> = {};

  console.log(`\n  === ${config.title} ===\n`);

  for (const section of config.sections) {
    if (section.type === "fields") {
      for (const field of section.fields) {
        const effectiveDefault =
          existingValues[field.key] ?? field.defaultValue ?? exampleValues[field.key] ?? "";
        const display = effectiveDefault ? ` [${effectiveDefault}]` : "";
        const answer = await ask(`  ${field.label}${display}: `);
        results[field.key] = answer || effectiveDefault;
      }
      console.log();
    } else {
      console.log(`  ${section.label}`);

      // Determine pre-selected providers (those with existing values)
      const preSelected: number[] = [];
      section.options.forEach((opt, i) => {
        if (opt.fields.some((f) => existingValues[f.key])) {
          preSelected.push(i + 1);
        }
      });

      section.options.forEach((opt, i) => {
        const marker = preSelected.includes(i + 1) ? " *" : "";
        console.log(`    ${i + 1}) ${opt.name}${marker}`);
      });

      const defaultSel = preSelected.join(",");
      const hint = defaultSel || "none";
      const display = defaultSel ? ` [${defaultSel}]` : "";
      const answer = await ask(
        `\n  Select (comma-separated numbers, Enter for ${hint})${display}: `,
      );

      const selStr = answer || defaultSel;
      const selected = selStr
        ? selStr
            .split(",")
            .map((s) => parseInt(s.trim()))
            .filter(
              (n) => !isNaN(n) && n >= 1 && n <= section.options.length,
            )
        : [];

      if (selected.length > 0) console.log();

      // Ask for keys of selected providers
      for (const idx of selected) {
        const provider = section.options[idx - 1];
        for (const field of provider.fields) {
          const effectiveDefault =
            existingValues[field.key] ?? field.defaultValue ?? exampleValues[field.key] ?? "";
          const display = effectiveDefault ? ` [${effectiveDefault}]` : "";
          const answer = await ask(`  ${field.label}${display}: `);
          results[field.key] = answer || effectiveDefault;
        }
      }

      // Set empty for unselected provider fields
      for (let i = 0; i < section.options.length; i++) {
        if (!selected.includes(i + 1)) {
          for (const field of section.options[i].fields) {
            results[field.key] = "";
          }
        }
      }
      console.log();
    }
  }

  rl.close();

  // Build .env content
  const lines: string[] = [];
  for (const section of config.sections) {
    if (section.comment) lines.push(`# ${section.comment}`);
    if (section.type === "fields") {
      for (const field of section.fields) {
        lines.push(`${field.key}=${results[field.key] ?? ""}`);
      }
    } else {
      for (const opt of section.options) {
        for (const field of opt.fields) {
          lines.push(`${field.key}=${results[field.key] ?? ""}`);
        }
      }
    }
    lines.push("");
  }

  // Preserve extra vars from existing .env that aren't in the wizard
  const wizardKeys = getWizardKeys(config);
  const extraVars = Object.entries(existingValues).filter(
    ([k]) => !wizardKeys.has(k),
  );
  if (extraVars.length > 0) {
    lines.push("# Additional settings");
    for (const [key, value] of extraVars) {
      lines.push(`${key}=${value}`);
    }
    lines.push("");
  }

  fs.writeFileSync(dotenvPath, lines.join("\n"));
  console.log(`  Configuration saved to ${dotenvPath}`);
  console.log(`  Review the file and restart.\n`);
}
