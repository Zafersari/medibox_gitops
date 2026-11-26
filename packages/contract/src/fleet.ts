import { z } from "zod";
import { Base64, DeviceId, GroupName, Sha256, Version } from "./common";

/*
 * GitOps desired state (M4). Everything under fleet/ in the repository:
 *   fleet/groups.yaml          DeviceGroups    – which device belongs to which group
 *   fleet/releases/<v>.yaml    FirmwareRelease – one manifest per firmware release
 *   fleet/target.yaml          FleetTarget     – which release the fleet should run
 * A rollout starts only when target.yaml changes in a commit. Rolling the whole
 * fleet back (S1) = reverting that commit.
 * The format follows Kubernetes conventions so it can later become CRDs (C2).
 */

export const API_VERSION = "medibox.dev/v1";

const Meta = z.object({ name: z.string().min(1).max(63) });

export const DeviceGroups = z.object({
  apiVersion: z.literal(API_VERSION),
  kind: z.literal("DeviceGroups"),
  spec: z.object({
    groups: z
      .array(
        z.object({
          name: GroupName,
          description: z.string().optional(),
          devices: z.array(DeviceId).min(1, "a group needs at least one device"),
        }),
      )
      .min(1),
  }),
});
export type DeviceGroups = z.infer<typeof DeviceGroups>;

export const FirmwareRelease = z.object({
  apiVersion: z.literal(API_VERSION),
  kind: z.literal("FirmwareRelease"),
  metadata: Meta,
  spec: z.object({
    version: Version,
    artifact: z.object({
      url: z.url(),
      sha256: Sha256,
      /** Detached ECDSA P-256 / SHA-256 signature over the binary (DER, base64). */
      signature: Base64,
    }),
    rollout: z.object({
      /** Groups in rollout order. The first wave is the canary. */
      waves: z.array(GroupName).min(1),
      /** Every device of a wave must report SUCCESS within this time, otherwise the rollout pauses. */
      healthDeadlineSeconds: z.number().int().min(30).max(86400).default(600),
      /** Number of failed devices in one wave that aborts the rollout. */
      failureThreshold: z.number().int().min(1).default(1),
    }),
    notes: z.string().optional(),
  }),
});
export type FirmwareRelease = z.infer<typeof FirmwareRelease>;

export const FleetTarget = z.object({
  apiVersion: z.literal(API_VERSION),
  kind: z.literal("FleetTarget"),
  spec: z.object({
    /** Version of the release (fleet/releases/<version>.yaml) the fleet should run. */
    release: Version,
  }),
});
export type FleetTarget = z.infer<typeof FleetTarget>;

/** Fully loaded and validated desired state. */
export interface Fleet {
  groups: DeviceGroups;
  releases: Map<string, FirmwareRelease>; // key: version
  target: FleetTarget;
}
