# Encrypted financial sync

Desktop `0.0.1-beta.5` supports encrypted sync for all current financial records.
Categories retain protocol 1; account/legacy ledger records use protocol 2;
income/payroll use protocol 3; source/month income forecasts use protocol 4;
remaining metadata and fully linked ledger groups use protocol 5. Balances and
remaining loan principal derive from immutable ledger entries and principal allocations.
Login/device/key setup alone never uploads data. Existing connections require
**Add remaining financial data** confirmation before the new scope is enabled.
Device appearance/language, credentials, encryption keys, runtime sync state and
local backup files/paths stay local. Continue keeping financial backups.

## Access and operation

Apply migrations through `0009_key_rotation.sql` with the normal migration runner. Set
`CLOUD_SYNC_ENABLED=true` to enable the API; its default is false. Each endpoint
requires the verified native Bearer token, an active registered device, the
account's current encrypted key package and a current server-side sync entitlement.
Ownership comes from authentication. Other-account datasets return 404.

Website Stripe checkout, optional trials, portal management and subscription
reconciliation are implemented; see [billing configuration](billing.md).
An operator can also grant an existing verified account an independent beta expiry:

```sh
bun run sync:access --email tester@example.com --until 2026-12-04T00:00:00Z
bun run sync:access --email tester@example.com --revoke
```

Choose a future UTC date. With Compose, run the same script in the migration image:

```sh
docker compose --env-file .env.compose run --rm migrate bun scripts/sync-access.ts --email tester@example.com --until 2026-12-04T00:00:00Z
```

There is no grant endpoint or automatic entitlement on login. Every push, pull
and snapshot checks expiry/revocation under the same account lock used for device
revocation. Expiry returns `PREMIUM_REQUIRED` (403), retains cloud history and
leaves local use available. Renewing a beta grant or verified paid subscription permits pending retries to resume.
No device or total-storage plan quota is introduced. Operational limits remain:
120 account requests/minute. Protocol 1 permits a 16,384-byte push body and
8,192-byte decoded ciphertext. Protocol 2 permits a 360,448-byte push body and
262,144-byte decoded ciphertext. Protocols 3 through 5 permit a 3,145,728-byte body and
2,097,152-byte decoded ciphertext, accommodating 100 full deduction descriptions.
Pages contain at most 50 changes and 800,000 encoded change bytes for older clients,
or 3,145,728 for protocol-3/4/5 clients; atomic records are never split. The new native
response cap is 4 MiB. Payment groups contain at most 256 entries, an operational request bound.
These are not subscription storage/device quotas. A 429 response includes `Retry-After: 60`.

New clients also send `X-Heyday-Keys: 2`. After key rotation, old clients receive
`CLIENT_UPGRADE_REQUIRED`; new obsolete-key writes receive `KEY_CHANGED`. Exact
previously accepted requests remain idempotent across epochs. See
[key rotation and history verification](key-rotation.md) for key selection, stable
record IDs, independent checkpoint transfer and verify-before-apply staging.

## Storage and wire contract

PostgreSQL stores relational ownership, head/version counters, opaque record IDs,
mutation IDs, encrypted envelopes and ordered history. It cannot query category
names, amounts, dates, account fields or local relationships. `cloud_sync_state` holds the dataset head;
`cloud_sync_changes` is immutable accepted history and retry receipts;
`cloud_sync_records` points to each record's latest change. The server sees owner,
record linkage, operation, versions, timing and payload sizes. E2EE does not hide
this operational metadata or the account email.

`src/contracts/v1/sync.ts` defines the strict JSON contract. Unknown fields are
rejected. Integers cross the wire as canonical nonnegative decimal strings up to
signed i64; incrementing an exhausted version is rejected. Base64url is canonical,
unpadded. Hashes are lowercase SHA-256 hex. The initial head is sequence `"0"`
and 64 zero characters.

`POST /api/v1/sync/push` accepts exactly:

```text
{
  protocol: 1 | 2 | 3 | 4 | 5, datasetId, mutationId, recordId, baseVersion,
  previous: { sequence, hash }, operation: "put" | "delete",
  payload: {
    format: "heyday-record-v2", algorithm: "A256GCM-HKDF-SHA256",
    keyId, salt, nonce, ciphertext
  },
  commitHash, commitMac
}
```

Under one transaction, the service checks the dataset head and record base version,
appends the next change and updates the record/head. Both preconditions must match.
Accepted response: `{kind:"accepted",change:{sequence,version,request}}`.
Identical mutation-ID retries return the original accepted change even after later
writes. Reusing the ID with different contents returns `MUTATION_ID_REUSED` (409).
A concurrency conflict returns 200 `{kind:"conflict",head,current}`, with current
either a change or null; it makes no record write. The client pulls, reconciles and
creates a new mutation only after this definitive rejection. A network failure
keeps the exact encrypted request for retry.

`GET /api/v1/sync/pull?datasetId=...&cursor=...&boundary=...` and
`GET /api/v1/sync/snapshot` use the same page shape:

```text
{ datasetId, head, boundary, changes:[{sequence,version,request}], cursor, hasMore }
```

Omit cursor/boundary initially. Cursor and boundary are opaque base64url compact
JSON `{datasetId,sequence,hash}`. Pass both back unchanged for subsequent pages.
The first page freezes a boundary; later pages read immutable history up to it,
with numeric sequence ordering. `head` can advance as other devices write.
After `hasMore:false`, begin another pull using the returned cursor without the
old boundary to receive subsequent writes. No transaction spans HTTP requests.

The initial snapshot **replays history** to a fixed boundary; it is not a compacted
materialized snapshot. This beta never prunes changes, tombstones or retry receipts,
so cursors do not expire. Missing or mismatched checkpoints fail closed with 409.
Pruning, compacted snapshots and expired-cursor recovery require a later protocol;
do not add a retention job that silently invalidates these assumptions.

## Cryptographic construction

The existing `heyday-key-v1` recovery package is unchanged. The active sync protocol
uses record v2; earlier record-v1 helpers are not accepted by these endpoints.
All arrays below use UTF-8 compact JSON, preserving the stated order. HKDF outputs
32 bytes. The dataset root key is IKM; the server never receives it.

1. Derive an ID key with HKDF-SHA256, no salt, info
   `["heyday-record-id-v1",datasetId,keyId]`. Wire record ID is base64url
   HMAC-SHA256(ID key, `[entity,localId]`), where entity is `category`,
   `account`, `income`, `income-plan`, `metadata` or `transaction`. Existing category IDs are unchanged. Entity and
   local IDs are not disclosed in the wire record ID.
2. For every new mutation generate independent random 32-byte mutation ID and salt
   and a 12-byte nonce. Derive its AES key using HKDF-SHA256(root, salt, info
   `["heyday-record-key-v2",datasetId,recordId,mutationId,keyId]`). One fresh derived
   key encrypts one message; retries reuse the stored ciphertext without encryption.
3. Encrypt using AES-256-GCM with a 16-byte tag. Maximum plaintext is 8,176 bytes for protocol 1, 262,128 for protocol 2 or 2,097,136 for protocols 3 through 5.
   AAD is `["heyday-record-v2","A256GCM-HKDF-SHA256",datasetId,recordId,mutationId,baseVersion,operation,keyId,salt]`.
4. `commitHash` is SHA-256 of
   `["heyday-sync-v1",datasetId,nextSequence,previousHash,recordId,mutationId,baseVersion,operation,keyId,salt,nonce,ciphertext]`.
   Protocols 2 through 5 use `"heyday-sync-v2"` through `"heyday-sync-v5"` respectively; all other fields and
   ordering are unchanged, so the selected protocol is authenticated.
5. Derive the history MAC key with HKDF-SHA256, no salt, info
   `["heyday-sync-mac-v1",datasetId,keyId]`. `commitMac` is base64url HMAC-SHA256 over
   the 32 raw commit digest bytes.

Encrypted plaintext is `{schema:1,entity:"category",id,value}`; value is
`{name,icon,isArchived}` or null for a deletion tombstone. Rust checks shape,
normalized names, icon allowlist, opaque ID mapping and operation agreement.
Archive state is a value, not deletion. The server validates envelope shape and
digest, but only clients can verify the MAC and decrypt/domain-validate content.
A stolen authorized session could submit invalid ciphertext and halt client sync;
the MAC prevents accepting it as valid data, but is not server-verifiable proof of
key possession. Stronger write authorization is part of the remaining security review.

The client verifies contiguous sequence, predecessor hash, MAC, record versions,
dataset/key identity and page boundary before committing a page. Its OS credential
entry pins the highest verified head, preserved on lock/sign-out. The pin is saved
before SQLite application or acknowledging an accepted upload. After a crash,
history replay can catch SQLite up to the pin. Bootstrap stages decrypted records
locally until its complete boundary is verified before merging local categories.

A saved checkpoint detects rollback of known history. A fresh device with only the
recovery key has no independent freshness proof; this protocol cannot rule out a
malicious server presenting separate valid histories to different devices. Device
revocation cannot erase keys already copied. Compromised-key rotation, trusted
device approval and independent cryptographic review remain release work.

## Ledger records and compatibility

New clients send `X-Heyday-Sync: 5` on push/pull/snapshot. The server records the
highest accepted protocol under the dataset lock. Clients advertising an older
protocol receive `CLIENT_UPGRADE_REQUIRED` (426), including on retries. New clients
can still send protocol-1/2/3/4 mutations and retry old pending ciphertext unchanged.

Financial plaintext is `{schema:2,entity:"account"|"transaction",id,value}`.
Account values contain the currency, name/type, immutable opening-balance string,
archive state, institution label, notes, last four digits and applicable loan/card
fields. They exclude current balances, credentials, timestamps and logo bytes.
Existing account type/opening balance cannot be overwritten during conflict
resolution. An empty device can adopt the cloud currency; an already-selected
currency must match. Enabling financial sync audits the local balance equation.

A transaction value contains `{currency,protected,entries}`. Each sorted entry has
its stable ID, type, participating account IDs, exact decimal amount, date,
description, optional payee/source label snapshots, category ID, linked loan ID
salary role and loan principal/interest/fee component. Imported source/loan labels
are also used by transaction history and Actual cashflow reports. A transfer has one entry covering both legs. Salary payments and
split loan repayments put all their ledger entries in one encrypted record.
Deletion is the usual encrypted null tombstone for the whole record. Ledger rows
are immutable: corrections delete then create a new ID. Conflicting replacement
of an existing ledger group is rejected rather than silently rewriting history.

Accounts/categories, then income definitions, upload before dependent groups and income forecast overrides. Downloaded missing dependencies
become explicit conflicts and are retried when dependencies arrive. Each financial
apply uses a SQLite savepoint: entries, label imports and checked balance deltas
all succeed or all roll back. Arithmetic uses i128 intermediates and checked i64
stored balances; money remains strings over JSON/IPC. Distinct offline transactions
merge by stable ID, without overwriting separately uploaded balances. Reconciled
deletions require explicit review before applying and retain reconciliation evidence.
Loan allocation constraints remain enforced on devices with native contracts.

SQLite migration 0005 adds financial consent and transactional ledger triggers.
`ledger_sync_members` and `ledger_sync_imports` contain financial grouping and
historical labels, not cloud ownership, keys or upload queues. They are retained in
backups; clear-all-data deletes them. Legacy and non-payroll protected groups remain read-only for local deletion until
their full planning metadata is present. Protocol 5 restores that metadata and supports native reversals across devices.

## Income and complete payroll records

Income plaintext is `{schema:3,entity:"income",id,value}`. Its value contains currency,
name/type, destination account ID, exact estimated gross, monthly recurrence/day,
active state and sorted stable deduction IDs with name, description, exact amount
and optional debt account ID. Editing an aggregate never posts money. Upsert retained
deduction IDs so their device-local cycle overrides survive; removed definitions
cascade their own overrides. Automatic transaction creation remains disabled.

Full payroll uses `{schema:3,entity:"transaction",id:"salary-<paymentId>",value}`.
The group retains its previous opaque record ID and gains `payroll` with payment ID,
income ID, occurrence month, paid date, exact gross/net, immutable deduction breakdown
and explicit deduction-to-principal transaction mappings. Each breakdown includes
historical name, debt account/name, principal, interest, fee and contract ID. Validate
all sums, roles, IDs and entry amounts before applying. Empty ledger groups are valid
only for complete payslips with no net deposit or principal repayment.

The native salary parent, transaction links, entries, balances and known contract
allocations commit together. A compatible protocol-2 group upgrades only its missing
metadata, without applying a second balance delta. Full payslips stay immutable;
corrections reverse then record again. Reversal uses the normal native payroll path,
including reconciliation review and restoration of any locally known contract principal.
Unknown loan contract IDs remain in the immutable payslip; they are never invented.
Protocol 5 restores these contracts; missing or conflicted contracts block dependent new payments until resolved.

Two offline payments can have different IDs but the same income/month. Pull rejects
the duplicate locally and exposes a conflict; prepare holds the competing local upload
while another live cloud payslip occupies that slot. To use cloud, reverse the unwanted
local payment in Income first. Keeping local deletion explicitly tombstones the cloud
payment, then allows the local replacement to upload. Dataset-head CAS serializes the
choices; the API never reads a plaintext business key.

SQLite `0006_income_sync.sql` adds separate `income_enabled` consent and transactional
income/deduction/payslip triggers. It queues zero-ledger payslips and their deletions.
Enabling queues existing definitions and upgrades existing native payroll while
preserving already-persisted protocol-2 ciphertext. PostgreSQL `0005_income_sync.sql`
allows protocol 3 and prevents old clients from consuming newer datasets.

## Income forecast overrides

SQLite `0007_income_planner_sync.sql` adds separate `planner_enabled` consent and
transactional insert/update/delete triggers on `planner_income_amounts` and
`planner_deduction_amounts`. Existing connections use **Add income forecasts**.
Opt-in queues existing overrides, including zero, without changing pending ciphertext.
PostgreSQL `0006_income_planner_sync.sql` admits protocol 4; after the first accepted
v4 record, clients advertising protocol 3 or earlier must update.

Plaintext is `{schema:4,entity:"income-plan",id,value}`. The ID is
`income_YYYY-MM_SOURCE_ID` or `deduction_YYYY-MM_SOURCE_ID`; the source retains its
existing 128-byte bound. Splitting at the first two underscores is unambiguous.
A value is `{source_type,source_id,month,currency:"THB",amount}` with a canonical
nonnegative i64 string. ID and value must agree; months span `0001-01`–`9999-12`.
One source/month is one encrypted record, so different months or deduction rows
can merge independently. There is no fixed limit on the number of forecast months.

An explicit zero is a value. Clearing sends an encrypted null tombstone and
restores the scheduled estimate. These changes never post transactions or alter
balances. Source/deduction relationships are checked locally; missing or conflicted
income definitions block upload/apply. A deleted deduction/source cannot cascade
away an offline forecast edit: reconcile its override conflict first, then either
accept removal or keep the definition and override. Deletions and conflicts use
the same durable queue, exact retries, dataset-head CAS and atomic cursor commits
as other encrypted records.

Protocol 4 covers source-linked gross income and salary-deduction overrides. Protocol 5
adds manual rows, debt/installment overrides, opening cash, completion status and payday
settings. Month keys stay fixed; the synced payday setting determines
its displayed date boundaries. Background refresh updates Outlook while retaining
an open editor draft. Backups retain forecast data and strip sync ownership as usual.

## Desktop durability and conflicts

SQLite migration `0004_category_sync.sql` adds account/origin binding, dirty
revisions, remote shadow and one durable pending request. Category/account/transaction/income/deduction/payslip/forecast triggers enqueue
changes in the same transaction as edits, even while paused. Applying downloaded
changes suppresses these triggers. Data, shadow, queue acknowledgements and cursor
commit together. An edit made during an upload remains queued after that older
version is acknowledged.

The first connection queues existing categories and stages the cloud history.
Identical records converge; untouched bundled categories adopt the cloud version.
Different existing local edits require an explicit choice. Duplicate names and
referenced deletions also become conflicts. Users can keep local, use cloud, or
rename the cloud category; stale choices are rejected by exact local/remote versions.
Local foreign keys and dependency checks protect financial relationships during merging.

After explicit enable, the app schedules sync on startup, focus, network recovery,
edits (three-second debounce), once a minute and manual retry. It bounds work per
run, backs off transient errors and pauses automatic retries for access/key/history
errors needing action. Pending records survive process restart, pause and sign-out.
A different signed-in account cannot take over a bound local database.

Backups remain ordinary local SQLite financial backups, not encrypted cloud exports.
Exports, pre-restore recovery copies and staged imports clear all sync bookkeeping;
restored data needs explicit reconnect/merge. Clear-all-data clears binding first,
so it does not enqueue cloud deletions. These actions do not delete retained cloud
data. Do not copy active SQLite files to clone sync ownership between devices.

## Complete financial metadata (protocol 5)

SQLite `0008_complete_sync.sql` adds `full_enabled` consent, transactional triggers,
stable reconciliation IDs and retained loan upgrade reservations. Its exact bytes
are immutable; `0009_sync_review_effects.sql` adds remote review/deletion triggers
without rewriting migration 8. PostgreSQL
`0007_complete_sync.sql` raises the accepted protocol ceiling. After the first v5
record, older clients receive 426. Exact older pending requests remain valid on
new clients. No plaintext financial columns are added to PostgreSQL.

Encrypted plaintext is `{schema:5,entity:"metadata",id,value}`. The identity is
`kind:primaryKey[:secondaryKey]`; `value` contains an allowlisted `kind`, exact
string-or-null `fields`, and sorted `children`. A null value is a tombstone.
SQL table/column names come only from compiled desktop schemas. Monetary values
never cross JSON as floating-point numbers. Supported kinds are:

- `logo`, `institution`, `payee`, `provider`, and `account-link`.
- `facility`, `contract`, `installment`, `subscription`, and `payment-plan`.
- `planner-item`, `planner-amount`, `debt-amount`, `installment-amount`, `cycle`,
  `opening`, and `settings` (currency and payday).
- `card-limit` with members; `statement` with captured entries, installment
  coverage, allocations and its payment plan; `default-history` with intervals.
- `payoff`, `reconciliation` with immutable audit entries, and `verification`.

Logos are encrypted base64 PNGs (128px maximum dimension, 100 KiB maximum encoded
file); hash and decoded dimensions are validated. Content hashes identify blobs
and resolve references to each device's existing local asset ID. Catalog entries
and logos share normal versioning/conflict rules. Fixed planner section definitions
are application reference data, not user-editable records.

Reconciliation records get a random stable `sync_id`; each device keeps its own
integer primary key and remaps verification references. Audit entries survive
transaction deletion. Deletion requires explicit review; missing ledger entries
in late-arriving evidence are marked for review and queued for propagation.

Loan records carry a stable principal basis. Remaining principal is calculated
from that basis minus native payment allocations; concurrent payments cannot
silently overwrite each other's principal changes. Protocol-5 transaction groups
carry complete loan components and borrowing/installment links. Legacy ledger
and payroll upgrades attach metadata without reposting balances. Temporary
`loan_sync_reservations` prevent a second principal reduction while upgrading;
these are financial metadata and remain in local backups. Equal payroll deductions
are mapped by immutable deduction/transaction IDs, not their amounts.

Dependencies are uploaded first and unresolved downloads are retried to a fixed
point. Conflicts preserve offline values and block dependent cascades. Unchanged
catalog seeds can adopt cloud versions on first contact. Existing local payday or
verification differences require an explicit choice during upgrade. Each aggregate
and cursor update uses the existing transaction/savepoint machinery.

The 2 MiB ciphertext bound also applies to metadata aggregates. This is an
operational record-size bound, not a subscription storage quota. Extremely large
single statements or reconciliation snapshots need future chunking before they
can sync; oversized records are rejected without dropping their local queue.

## Validation and remaining rollout

API and real PostgreSQL tests cover exact retries, mutation reuse, concurrent CAS,
ownership, entitlement expiry/resumption, revocation, rollback, numeric multi-page
ordering and a snapshot overlapping writes. Rust tests cover shared Web Crypto
vectors, tampering, two-device category reconciliation, newer edits during upload,
atomic queue failure, durable restart, duplicate names, referenced deletion and
backup sanitization. Browser tests mock native IPC for confirmation, offline and
conflict UI, Thai, scheduling, rate limits and access expiry. Ledger tests cover exact balances
beyond 2^53, concurrent transactions, deletion during upload, currency mismatch,
overflow, payroll grouping and failure during the second entry of an atomic group.
PostgreSQL tests cover protocol-2/3/4/5 upgrades, 2 MiB ciphertext, exact retries, access
expiry and bounded pagination. Income/payroll tests cover atomic definition edits,
retained overrides, zero-ledger payslips, legacy upgrade with a pending request,
duplicate monthly payments, multiple months paid on one day, remote reversal,
missing contracts, exact large amounts and maximum supported deduction descriptions.
Shared protocol-3/4/5 fixtures are verified with Node/Web Crypto and Rust. Forecast tests cover zero/clear semantics, separate months, offline conflicts, source deletion, consent, missing dependencies and edits during upload.

Packaged two-device tests must still exercise actual HTTP, OS key storage, recovery,
lost responses and app restart together. The automated layers do not substitute
for that smoke test. Railway rollout, storage growth/latency measurement, Stripe activation and sandbox smoke testing,
key rotation, history compaction and independent security review remain unfinished.
