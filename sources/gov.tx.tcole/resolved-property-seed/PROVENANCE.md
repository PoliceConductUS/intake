# Resolved-property seed — gov.tx.tcole

These `*.ResolvedProperty.yaml` files are committed **seed entries for the
intake ResolvedProperty cache**. At `intake run gov.tx.tcole`, each is copied
into `$INTAKE_WORKSPACE/intake/state/namespaces/intake/ResolvedProperty/` **only
if that file does not already exist** — whatever is on disk wins. The resolver
then reads them as ordinary cache hits, so no source- or property-specific code
is involved (see `seedResolvedPropertyCache`, ADR 0018 point 8).

They exist because the import **fails loud** on any agency whose address the
Census geocoder cannot resolve to coordinates. The agencies below are active
TCOLE agencies that belong in the database but whose 2025-02-10 address is a
PO box, a placeholder, or out-of-jurisdiction — the geocoder cannot derive their
coordinates, so they are supplied here as a manual resolution. The values are
the coordinates carried in the production record.

Keyed in the cache by canonical `Agency` id + property (`latitude` / `longitude`).

| DEPARTMENT_NUMBER | Agency                                   | Canonical id              | lat, lng                | Why manual                                                    |
| ----------------- | ---------------------------------------- | ------------------------- | ----------------------- | ------------------------------------------------------------- |
| 201937            | ALIEF I.S.D. POLICE DEPT.                | cm7a0bgo800l1ewvg23w03i5y | 29.7110641, -95.5963337 | PO-box-only address (P. O. BOX 68, ALIEF)                     |
| 231905            | Bland ISD Police Department              | cm7a0bgob012hewvgnssusuyi | 33.2157217, -96.2886628 | PO box + rural FM route (Merit)                               |
| 347904            | Woden I.S.D. Police Dept.                | cm7a0bgoi02a9ewvgkbro2fze | 31.5032387, -94.5265962 | PO-box-only address (Woden)                                   |
| 449701            | TITUS CO. FRESH WATER SUPP. POLICE DEPT. | cm7a0bgoo03daewvgnre5hhsx | 33.1569602, -94.9695517 | PO-box-only address (Mt. Pleasant)                            |
| 509914            | DEPARTMENT OF HOMELAND SECURITY          | cm7a0bgot047fewvg018es16l | 38.9390565, -77.0845735 | Placeholder address `0, x, TX 0`; federal DHS (Washington DC) |

(STATE OF INDIANA / 515014 was a placeholder with no address, city, or zip in the
source and no location data available — it is `excluded.yaml`-excluded rather than
seeded here.)

To regenerate (e.g. if canonical ids change), write one ResolvedProperty
envelope per agency × {latitude, longitude} via `ResolvedProperty.write` into
this directory — the filename it produces matches the cache filename exactly.
