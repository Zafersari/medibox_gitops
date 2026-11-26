# medibox-gitops

GitOps firmware rollout & fallback for the MediBox ESP32 fleet – WPF2 (DevOps), FH Campus Wien.
Topic 02 of the WPF2 catalogue, applied to MediBox (temperature + box-opened telemetry).

```
 fleet/ (Git)  ──►  rollout controller  ──MQTT──►  MediBox devices (ESP32 / simulated)
     ▲                    │    ▲                         │
     │ PR with manifest   │    └──── status / telemetry ─┘
 CI: build, sign, publish │
                          └──►  Mosquitto + PostgreSQL (telemetry, dedup, gaps)
```

## Repository layout

| Path | Content | Requirement |
|---|---|---|
| `fleet/` | desired state: device groups, release manifests, fleet target | M4 |
| `packages/contract/` | shared MQTT contract + manifest schemas and validation (TypeScript, zod) | M1–M6 |
| `scripts/validate-fleet.ts` | CI check for `fleet/` | M4 |
| `docs/mqtt-contract.md` | topics, payloads, device update states | M2, M3 |
| `.github/workflows/` | CI | M4, M7 |

Coming next: `deploy/` (Mosquitto + PostgreSQL, M9), `packages/fake-device/`,
`packages/controller/` (M5, M6), `firmware/` (ESP-IDF, M1–M3) and the firmware pipeline (M7).

## Getting started

Requires Node.js 22+.

```bash
npm install
npm test            # unit tests for the contract and the manifest validation
npm run validate    # validate fleet/ (same check as in CI)
npm run typecheck
```

## How a rollout is started

1. CI builds and signs a firmware release and opens a pull request that adds
   `fleet/releases/<version>.yaml` and changes `fleet/target.yaml`.
2. The `fleet-validate` workflow checks the manifests; an invalid manifest cannot be merged.
3. After the merge the controller sees the new target and rolls it out wave by wave
   (`rollout.waves`, canary first).
4. Rolling the whole fleet back = `git revert` of the merge commit.
