import { z } from "zod";
import { Base64, DeviceId, Sha256, Version } from "./common";

/*
 * MQTT contract between MediBox devices (real ESP32 or simulated) and the backend.
 * The real firmware and the fake device must follow this contract exactly, so the
 * controller never needs to know which kind of device it is talking to.
 * Human-readable version: docs/mqtt-contract.md
 */

export const TOPIC_ROOT = "medibox";

export const topics = {
  /** device → backend, QoS 1, not retained */
  telemetry: (id: string) => `${TOPIC_ROOT}/${id}/telemetry`,
  /** device → backend, QoS 1, retained; LWT publishes {"online":false} */
  online: (id: string) => `${TOPIC_ROOT}/${id}/online`,
  /** device → backend, QoS 1, retained: current firmware + update state */
  status: (id: string) => `${TOPIC_ROOT}/${id}/status`,
  /** controller → device, QoS 1, retained: desired firmware (empty payload = no update) */
  updateCommand: (id: string) => `${TOPIC_ROOT}/${id}/cmd/update`,
} as const;

/** Wildcard subscriptions for the backend side. */
export const subscriptions = {
  telemetry: `${TOPIC_ROOT}/+/telemetry`,
  online: `${TOPIC_ROOT}/+/online`,
  status: `${TOPIC_ROOT}/+/status`,
} as const;

export type TopicKind = "telemetry" | "online" | "status" | "updateCommand";

/** Parse a topic into device ID and kind; returns null for topics outside the contract. */
export function parseTopic(topic: string): { deviceId: string; kind: TopicKind } | null {
  const parts = topic.split("/");
  if (parts[0] !== TOPIC_ROOT || parts.length < 3) return null;
  const deviceId = parts[1]!;
  if (!DeviceId.safeParse(deviceId).success) return null;
  const rest = parts.slice(2).join("/");
  if (rest === "telemetry") return { deviceId, kind: "telemetry" };
  if (rest === "online") return { deviceId, kind: "online" };
  if (rest === "status") return { deviceId, kind: "status" };
  if (rest === "cmd/update") return { deviceId, kind: "updateCommand" };
  return null;
}

// ---------------------------------------------------------------------------
// Telemetry (M1)
// ---------------------------------------------------------------------------

const TelemetryBase = z.object({
  deviceId: DeviceId,
  fwVersion: Version,
  /** Increases by 1 per message and survives reboots (persisted in NVS). Used for dedup + gap detection. */
  seq: z.number().int().nonnegative().max(0xffffffff),
  /** Creation time on the device (Unix ms, from SNTP). null if the clock was not synced yet. */
  ts: z.number().int().nonnegative().nullable(),
});

export const TemperatureTelemetry = TelemetryBase.extend({
  type: z.literal("temperature"),
  celsius: z.number().min(-55).max(125), // DS18B20 range
});

export const BoxTelemetry = TelemetryBase.extend({
  type: z.literal("box"),
  /** true = box opened (reed switch released), false = closed */
  open: z.boolean(),
});

export const Telemetry = z.discriminatedUnion("type", [TemperatureTelemetry, BoxTelemetry]);
export type Telemetry = z.infer<typeof Telemetry>;

// ---------------------------------------------------------------------------
// Online / offline (MQTT last will)
// ---------------------------------------------------------------------------

export const OnlineMessage = z.object({
  online: z.boolean(),
  /** Set by the device on connect; absent in the last-will message. */
  fwVersion: Version.optional(),
});
export type OnlineMessage = z.infer<typeof OnlineMessage>;

// ---------------------------------------------------------------------------
// Update state reported by the device (M2, M3)
// ---------------------------------------------------------------------------

export const UpdateState = z.enum([
  /** No update in progress. */
  "IDLE",
  "DOWNLOADING",
  /** Download failed after the device's own retries. Transport problem, NOT a firmware failure. */
  "DOWNLOAD_FAILED",
  "VERIFYING",
  /** Hash or signature did not match. Image was never booted. Counts as rollout failure. */
  "VERIFY_FAILED",
  /** Booted into the new image, self-test running or waiting for the network. */
  "PENDING_SELFTEST",
  /** Self-test passed, new image confirmed as last known good. */
  "SUCCESS",
  /** Device went back to the previous slot on its own (local rollback). Counts as rollout failure. */
  "ROLLED_BACK",
]);
export type UpdateState = z.infer<typeof UpdateState>;

/** States the controller counts as a failure of the release (rollout abort, M6). */
export const FAILURE_STATES: readonly UpdateState[] = ["VERIFY_FAILED", "ROLLED_BACK"];

export const DeviceStatus = z.object({
  deviceId: DeviceId,
  /** Firmware version that is running right now. */
  fwVersion: Version,
  state: UpdateState,
  /** Rollout this state belongs to (from the update command); null when IDLE without any rollout. */
  rolloutId: z.string().min(1).nullable(),
  /** Version the device was asked to install; null when no update was requested. */
  targetVersion: Version.nullable(),
  /** Short machine-readable reason for failure states, e.g. "selftest:sensor", "signature". */
  reason: z.string().max(64).nullable(),
  ts: z.number().int().nonnegative().nullable(),
});
export type DeviceStatus = z.infer<typeof DeviceStatus>;

// ---------------------------------------------------------------------------
// Update command sent by the controller (M5)
// ---------------------------------------------------------------------------

export const UpdateCommand = z.object({
  /** Unique per rollout, e.g. "1.1.0@3f2a9c1" (release version @ Git commit). */
  rolloutId: z.string().min(1).max(64),
  version: Version,
  url: z.url(),
  sha256: Sha256,
  /** Detached ECDSA P-256 / SHA-256 signature over the firmware binary, DER, base64. */
  signature: Base64,
  /** Unix ms when the controller issued the command. */
  issuedAt: z.number().int().nonnegative(),
});
export type UpdateCommand = z.infer<typeof UpdateCommand>;

/** Build a rollout ID from a release version and a Git commit hash. */
export function makeRolloutId(version: string, commit: string): string {
  return `${version}@${commit.slice(0, 7)}`;
}

/** Parse a JSON MQTT payload against a schema. Returns a result instead of throwing. */
export function parsePayload<T extends z.ZodType>(
  schema: T,
  payload: Buffer | string,
): { ok: true; value: z.infer<T> } | { ok: false; error: string } {
  let json: unknown;
  try {
    json = JSON.parse(typeof payload === "string" ? payload : payload.toString("utf8"));
  } catch {
    return { ok: false, error: "payload is not valid JSON" };
  }
  const res = schema.safeParse(json);
  if (!res.success) return { ok: false, error: z.prettifyError(res.error) };
  return { ok: true, value: res.data };
}
