# Stock structure support

Structure search, names, access-scoped docking and configuration-only Home use stock methods. Stateless account-owned search with system zero enumerates accessible IDs; held [0] search follows the current system. Neither query grants service rights or moves a pilot.

Service-gated structure inventory, fitting and corporation-office actions return STRUCTURE_SERVICE_AUTHORITY_UNAVAILABLE on stock web gateway. Missing services remain UNKNOWN rather than an empty authoritative list. NPC station paths remain available. Native structureSettings.CharacterGetServices and officeManager.RentOffice exist, but a safe adapter for an already held web pilot needs upstream agreement. Docking permission is insufficient to infer service permission.

On the game port (`EVEJS_PILOT_TRANSPORT=gameport`, the default) a held pilot's transport is a client of the original game protocol, and asks `structureSettings.CharacterGetServices` as the retail client asks it, as the pilot docks in a structure. There the service check of the held pilot's own structure, and `GET /api/dockable-structures/:id/services` for it, are answered from that, by the retail client's own rule: docking and fitting for anyone docked, any other service by the server's answer. No EveJS change, patch or adapter is involved, and the stock web gateway path above is unchanged. `docs/bridge-wire-contract.md`, "A structure's services", has the detail (commit `6e822f73`, 2026-10-12).

LEGACY — DO NOT DEPLOY: former Upwell allowlist/core patches are retired; use no WC runtime patch. See [stock integration policy](stock-evejs-integration-policy.md).
