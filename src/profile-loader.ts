import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

import { ProfileConfig, ProfileSchema } from "./profile-schema";

function formatSchemaError(error: string): string {
  return error.replace(/\n/g, " ").trim();
}

export function loadProfile(profileName: string): ProfileConfig {
  const profilePath = path.resolve(process.cwd(), "profiles", `${profileName}.yaml`);

  if (!fs.existsSync(profilePath)) {
    throw new Error(`Profile not found: '${profileName}' (${profilePath})`);
  }

  const source = fs.readFileSync(profilePath, "utf8");
  let parsed: unknown;

  try {
    parsed = YAML.parse(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid YAML in ${profilePath}: ${formatSchemaError(message)}`);
  }

  const result = ProfileSchema.safeParse(parsed);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Profile validation failed for ${profilePath}: ${details}`);
  }

  return result.data;
}
