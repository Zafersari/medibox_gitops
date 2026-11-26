import { cp, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadFleet, validateFleetDocs } from "./validate";

const FLEET_DIR = path.resolve(import.meta.dirname, "../../../fleet");

const groups = {
  apiVersion: "medibox.dev/v1",
  kind: "DeviceGroups",
  spec: { groups: [{ name: "canary", devices: ["medibox-01"] }, { name: "rest", devices: ["medibox-02"] }] },
};
const release = (version: string, extra: Record<string, unknown> = {}) => ({
  apiVersion: "medibox.dev/v1",
  kind: "FirmwareRelease",
  metadata: { name: `medibox-fw-${version}` },
  spec: {
    version,
    artifact: { url: `https://example.org/medibox-${version}.bin`, sha256: "a".repeat(64), signature: "QUJDRA==" },
    rollout: { waves: ["canary", "rest"] },
    ...extra,
  },
});
const target = (v: string) => ({ apiVersion: "medibox.dev/v1", kind: "FleetTarget", spec: { release: v } });
const docs = (rel: object[], t = target("1.0.0"), g: object = groups) => ({
  groups: { file: "groups.yaml", data: g },
  target: { file: "target.yaml", data: t },
  releases: rel.map((r) => ({ file: `releases/${(r as any).spec.version}.yaml`, data: r })),
});

describe("validateFleetDocs", () => {
  it("accepts a valid fleet and applies defaults", () => {
    const res = validateFleetDocs(docs([release("1.0.0")]));
    expect(res.errors).toEqual([]);
    const rel = res.fleet!.releases.get("1.0.0")!;
    expect(rel.spec.rollout.healthDeadlineSeconds).toBe(600);
    expect(rel.spec.rollout.failureThreshold).toBe(1);
  });

  it("rejects a release without hash or signature", () => {
    const bad = release("1.0.0");
    delete (bad.spec.artifact as any).sha256;
    delete (bad.spec.artifact as any).signature;
    const res = validateFleetDocs(docs([bad]));
    expect(res.fleet).toBeUndefined();
    expect(res.errors.map((e) => e.message).join("\n")).toMatch(/sha256/);
    expect(res.errors.map((e) => e.message).join("\n")).toMatch(/signature/);
  });

  it("rejects a malformed hash and a non-semver version", () => {
    const bad = release("1.0");
    (bad.spec.artifact as any).sha256 = "XYZ";
    const res = validateFleetDocs(docs([bad], target("1.0.0")));
    const msgs = res.errors.map((e) => e.message).join("\n");
    expect(msgs).toMatch(/sha256 must be 64/);
    expect(msgs).toMatch(/semver/);
  });

  it("rejects a target that points to a release without manifest", () => {
    const res = validateFleetDocs(docs([release("1.0.0")], target("2.0.0")));
    expect(res.errors).toContainEqual({ file: "target.yaml", message: "spec.release 2.0.0 has no manifest in releases/" });
  });

  it("rejects waves with unknown groups", () => {
    const res = validateFleetDocs(docs([release("1.0.0", { rollout: { waves: ["canary", "beta"] } })]));
    expect(res.errors.some((e) => e.message.includes('unknown group "beta"'))).toBe(true);
  });

  it("rejects a device that is in two groups", () => {
    const g = structuredClone(groups);
    g.spec.groups[1]!.devices.push("medibox-01");
    const res = validateFleetDocs(docs([release("1.0.0")], target("1.0.0"), g));
    expect(res.errors.some((e) => e.message.includes('"medibox-01" is in group'))).toBe(true);
  });

  it("rejects a file name that does not match the version", () => {
    const d = docs([release("1.0.0")]);
    d.releases[0]!.file = "releases/latest.yaml";
    expect(validateFleetDocs(d).errors[0]!.message).toMatch(/expected 1.0.0.yaml/);
  });

  it("warns when a group is left out of the waves", () => {
    const res = validateFleetDocs(docs([release("1.0.0", { rollout: { waves: ["canary"] } })]));
    expect(res.errors).toEqual([]);
    expect(res.warnings[0]!.message).toMatch(/rest/);
  });
});

describe("loadFleet", () => {
  it("the fleet/ directory in this repository is valid", async () => {
    const res = await loadFleet(FLEET_DIR);
    expect(res.errors).toEqual([]);
    expect(res.fleet!.target.spec.release).toBe("1.0.0");
  });

  it("reports YAML syntax errors with the file name", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "fleet-"));
    await cp(FLEET_DIR, dir, { recursive: true });
    await writeFile(path.join(dir, "target.yaml"), "spec: [unclosed\n");
    const res = await loadFleet(dir);
    expect(res.fleet).toBeUndefined();
    expect(res.errors[0]!.file).toBe("target.yaml");
    expect(res.errors[0]!.message).toMatch(/YAML syntax error/);
  });
});
