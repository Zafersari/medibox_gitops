import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { DeviceGroups, FirmwareRelease, FleetTarget, type Fleet } from "./fleet";

export interface Issue {
  file: string;
  message: string;
}

export interface FleetValidation {
  errors: Issue[];
  warnings: Issue[];
  /** Only set when there are no errors. */
  fleet?: Fleet;
}

export interface RawDoc {
  /** Path relative to the fleet directory, used in messages. */
  file: string;
  data: unknown;
}

function schemaIssues(file: string, err: z.ZodError): Issue[] {
  return err.issues.map((i) => ({
    file,
    message: `${i.path.length ? i.path.join(".") + ": " : ""}${i.message}`,
  }));
}

/**
 * Validate the desired state: schema of every document plus the cross-checks
 * a schema alone cannot express. Pure function — used by the CI check and by
 * the controller before it starts any rollout.
 */
export function validateFleetDocs(input: {
  groups: RawDoc | null;
  target: RawDoc | null;
  releases: RawDoc[];
}): FleetValidation {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];

  // --- groups ---------------------------------------------------------------
  let groups: DeviceGroups | undefined;
  if (!input.groups) errors.push({ file: "groups.yaml", message: "file is missing" });
  else {
    const r = DeviceGroups.safeParse(input.groups.data);
    if (!r.success) errors.push(...schemaIssues(input.groups.file, r.error));
    else groups = r.data;
  }
  const groupNames = new Set<string>();
  if (groups) {
    const seenDevice = new Map<string, string>();
    for (const g of groups.spec.groups) {
      if (groupNames.has(g.name)) errors.push({ file: input.groups!.file, message: `group "${g.name}" is defined twice` });
      groupNames.add(g.name);
      for (const d of g.devices) {
        const other = seenDevice.get(d);
        if (other) errors.push({ file: input.groups!.file, message: `device "${d}" is in group "${other}" and "${g.name}" – each device must be in exactly one group` });
        else seenDevice.set(d, g.name);
      }
    }
  }

  // --- releases -------------------------------------------------------------
  const releases = new Map<string, FirmwareRelease>();
  for (const doc of input.releases) {
    const r = FirmwareRelease.safeParse(doc.data);
    if (!r.success) {
      errors.push(...schemaIssues(doc.file, r.error));
      continue;
    }
    const rel = r.data;
    const v = rel.spec.version;
    const expectedFile = `${v}.yaml`;
    if (path.basename(doc.file) !== expectedFile)
      errors.push({ file: doc.file, message: `file name must match the version: expected ${expectedFile}` });
    if (releases.has(v)) errors.push({ file: doc.file, message: `version ${v} is defined twice` });
    if (groups) {
      const seenWave = new Set<string>();
      for (const w of rel.spec.rollout.waves) {
        if (!groupNames.has(w)) errors.push({ file: doc.file, message: `rollout.waves: unknown group "${w}" (not in groups.yaml)` });
        if (seenWave.has(w)) errors.push({ file: doc.file, message: `rollout.waves: group "${w}" appears twice` });
        seenWave.add(w);
      }
      const uncovered = [...groupNames].filter((g) => !seenWave.has(g));
      if (uncovered.length)
        warnings.push({ file: doc.file, message: `groups not in rollout.waves (will not be updated): ${uncovered.join(", ")}` });
    }
    releases.set(v, rel);
  }

  // --- target ---------------------------------------------------------------
  let target: FleetTarget | undefined;
  if (!input.target) errors.push({ file: "target.yaml", message: "file is missing" });
  else {
    const r = FleetTarget.safeParse(input.target.data);
    if (!r.success) errors.push(...schemaIssues(input.target.file, r.error));
    else {
      target = r.data;
      if (!releases.has(target.spec.release))
        errors.push({ file: input.target.file, message: `spec.release ${target.spec.release} has no manifest in releases/` });
    }
  }

  if (errors.length || !groups || !target) return { errors, warnings };
  return { errors, warnings, fleet: { groups, releases, target } };
}

async function readYaml(dir: string, rel: string, errors: Issue[]): Promise<RawDoc | null> {
  let text: string;
  try {
    text = await readFile(path.join(dir, rel), "utf8");
  } catch {
    return null;
  }
  try {
    return { file: rel, data: parseYaml(text) };
  } catch (e) {
    errors.push({ file: rel, message: `YAML syntax error: ${(e as Error).message.split("\n")[0]}` });
    return { file: rel, data: undefined };
  }
}

/** Load fleet/ from disk and validate it. */
export async function loadFleet(dir: string): Promise<FleetValidation> {
  const yamlErrors: Issue[] = [];
  const groups = await readYaml(dir, "groups.yaml", yamlErrors);
  const target = await readYaml(dir, "target.yaml", yamlErrors);

  let releaseFiles: string[] = [];
  try {
    releaseFiles = (await readdir(path.join(dir, "releases")))
      .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
      .sort();
  } catch {
    yamlErrors.push({ file: "releases/", message: "directory is missing" });
  }
  const releases: RawDoc[] = [];
  for (const f of releaseFiles) {
    const doc = await readYaml(dir, `releases/${f}`, yamlErrors);
    if (doc) releases.push(doc);
  }

  const result = validateFleetDocs({ groups, target, releases });
  if (yamlErrors.length) {
    // A YAML syntax error also produces schema errors for the same file; keep only the syntax error.
    const broken = new Set(yamlErrors.map((e) => e.file));
    const rest = result.errors.filter((e) => !broken.has(e.file));
    return { errors: [...yamlErrors, ...rest], warnings: result.warnings };
  }
  return result;
}
