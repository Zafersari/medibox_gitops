import { z } from "zod";

/** Device IDs as used in MQTT topics and fleet manifests, e.g. "medibox-01". */
export const DeviceId = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/, "device ID must be lowercase letters, digits and dashes (3–32 chars)");
export type DeviceId = z.infer<typeof DeviceId>;

/** Firmware versions are plain semantic versions: MAJOR.MINOR.PATCH (no pre-release tags). */
export const Version = z
  .string()
  .regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/, "version must be semver MAJOR.MINOR.PATCH, e.g. 1.2.0");
export type Version = z.infer<typeof Version>;

export const GroupName = z
  .string()
  .regex(/^[a-z][a-z0-9-]{0,31}$/, "group name must be lowercase letters, digits and dashes");

/** Lowercase hex SHA-256 digest of the firmware binary. */
export const Sha256 = z.string().regex(/^[0-9a-f]{64}$/, "sha256 must be 64 lowercase hex characters");

/** Base64 (standard alphabet) — used for the detached ECDSA P-256 signature (DER). */
export const Base64 = z
  .string()
  .min(4)
  .regex(/^[A-Za-z0-9+/]+={0,2}$/, "signature must be base64");

/** Compare two semver strings. Returns <0, 0, >0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}
