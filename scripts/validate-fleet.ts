/**
 * CI check for the GitOps desired state (M4, acceptance criterion 2):
 * an invalid manifest fails the pipeline and can never be rolled out.
 *
 *   npm run validate            # validates ./fleet
 *   npx tsx scripts/validate-fleet.ts path/to/fleet
 */
import path from "node:path";
import { loadFleet } from "@medibox/contract";

const dir = path.resolve(process.argv[2] ?? "fleet");
const { errors, warnings, fleet } = await loadFleet(dir);

for (const w of warnings) console.warn(`WARN  ${w.file}: ${w.message}`);
for (const e of errors) console.error(`ERROR ${e.file}: ${e.message}`);

if (!fleet) {
  console.error(`\n✗ fleet/ is invalid (${errors.length} error${errors.length === 1 ? "" : "s"})`);
  process.exit(1);
}

const target = fleet.releases.get(fleet.target.spec.release)!;
const deviceCount = fleet.groups.spec.groups.reduce((n, g) => n + g.devices.length, 0);
console.log(`✓ fleet/ is valid`);
console.log(`  groups:   ${fleet.groups.spec.groups.map((g) => `${g.name} (${g.devices.length})`).join(", ")} – ${deviceCount} devices`);
console.log(`  releases: ${[...fleet.releases.keys()].join(", ")}`);
console.log(`  target:   ${target.spec.version} – waves: ${target.spec.rollout.waves.join(" → ")}`);
