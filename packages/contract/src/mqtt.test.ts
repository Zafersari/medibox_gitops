import { describe, expect, it } from "vitest";
import { DeviceStatus, Telemetry, UpdateCommand, makeRolloutId, parsePayload, parseTopic, topics } from "./mqtt";

describe("topics", () => {
  it("builds and parses device topics", () => {
    expect(topics.status("medibox-01")).toBe("medibox/medibox-01/status");
    expect(parseTopic("medibox/medibox-01/cmd/update")).toEqual({ deviceId: "medibox-01", kind: "updateCommand" });
    expect(parseTopic("tele/tasmota_13F27E/SENSOR")).toBeNull();
    expect(parseTopic("medibox/Bad_ID/status")).toBeNull();
  });
});

describe("payloads", () => {
  it("accepts temperature and box telemetry", () => {
    const base = { deviceId: "medibox-01", fwVersion: "1.0.0", seq: 42, ts: 1764147600000 };
    expect(Telemetry.safeParse({ ...base, type: "temperature", celsius: 21.5 }).success).toBe(true);
    expect(Telemetry.safeParse({ ...base, type: "box", open: true }).success).toBe(true);
    expect(Telemetry.safeParse({ ...base, ts: null, type: "box", open: false }).success).toBe(true);
    expect(Telemetry.safeParse({ ...base, type: "temperature", celsius: 300 }).success).toBe(false);
  });

  it("parses a status payload from a buffer", () => {
    const status = {
      deviceId: "medibox-02", fwVersion: "1.0.0", state: "ROLLED_BACK",
      rolloutId: "1.1.0@3f2a9c1", targetVersion: "1.1.0", reason: "selftest:sensor", ts: null,
    };
    const res = parsePayload(DeviceStatus, Buffer.from(JSON.stringify(status)));
    expect(res.ok).toBe(true);
    expect(parsePayload(DeviceStatus, "not json")).toEqual({ ok: false, error: "payload is not valid JSON" });
  });

  it("validates update commands", () => {
    const cmd = {
      rolloutId: makeRolloutId("1.1.0", "3f2a9c1e88d0"), version: "1.1.0",
      url: "https://example.org/fw.bin", sha256: "b".repeat(64), signature: "QUJDRA==", issuedAt: 1,
    };
    expect(cmd.rolloutId).toBe("1.1.0@3f2a9c1");
    expect(UpdateCommand.safeParse(cmd).success).toBe(true);
    expect(UpdateCommand.safeParse({ ...cmd, url: "not a url" }).success).toBe(false);
  });
});
