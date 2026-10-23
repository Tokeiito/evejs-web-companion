# Login rewards

Daily and seasonal reward claims use the selected pilot's account through the game port. Claiming puts rewards in
that account's Redeem Items queue. The web gateway does not carry these campaign calls.

The server supplies a seasonal campaign's ID and claim history. Names and reward previews come from an optional
operator-owned JSON file, read at runtime. A missing or invalid file leaves the seasonal campaign claim available
with a generic name; it does not stop claims. No extracted client data is shipped in the web bundle or repository.

To install previews from your own client, run on Windows with the existing client data tooling:

```powershell
node scripts/build-seasonal-campaigns.js "C:\path\to\EVE client"
```

The client directory contains `tq` and `ResFiles`. The tool uses `EVEJS_PYTHON` (default `python`) to read the client's
own built data and writes `seasonal-campaigns.json` under `EVEJS_WEB_POC_DATA_DIR` (default ignored `data/`). Set
`EVEJS_SEASONAL_CAMPAIGNS_FILE` on both the generator and BFF to choose another absolute file path. A custom path
inside the checkout must be Git-ignored; keep all generated and client-derived files outside commits. Regenerate
after changing client builds. File replacements are read on subsequent requests without a server restart.

The format is `{ "version": 1, "build": <client build>, "campaigns": { "<campaign ID>": <definition> } }`. A definition
has `name`, boolean `retroClaim`, and `alpha`/`omega` arrays of `[zero-based day, typeID, quantity, tier]`. The BFF
returns only validated presentation fields for the requested positive ID from authenticated
`GET /api/login-rewards/campaigns/:id`; browsers cannot supply file paths. An unreadable, malformed or oversized
file returns a null definition, as does an unknown campaign.
