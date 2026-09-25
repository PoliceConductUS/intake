import { seedLedgerFromIdentityMaps } from "../src/cli/state/source-name-to-canonical-id/seed-from-identity-maps.js";

/**
 * One-time bootstrap: seed the SourceNameToCanonicalId ledger for a namespace
 * from a directory of external identity maps so a reconstruction reuses existing
 * canonical IDs instead of minting new ones.
 *
 * Usage:
 *   INTAKE_WORKSPACE=/abs/workspace \
 *     tsx scripts/seed-tcole-ledger.ts gov.tx.tcole /abs/identity/sources/tcole
 */
const [namespace, identityDir] = process.argv.slice(2);
if (namespace === undefined || identityDir === undefined) {
  console.error(
    "Usage: tsx scripts/seed-tcole-ledger.ts <namespace> <identityDir>",
  );
  process.exit(1);
}

const counts = await seedLedgerFromIdentityMaps(namespace, identityDir);
console.log(
  `Seeded ${namespace} ledger: ${counts.agencies} agencies, ${counts.personnel} personnel, ${counts.agencyPersonnel} agency-personnel.`,
);
