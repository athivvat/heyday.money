# Encryption key rotation and history verification

Implemented in the desktop and account API. This protocol has **not received an
independent security review**. The review brief is [security-review.md](security-review.md).

## User behavior

Settings → Heyday account → Advanced security offers **Replace recovery key**.
The user saves and re-enters a new randomly generated recovery key and confirms
that support cannot recover it. Replacement also generates a new independent
dataset encryption key. It never uploads plaintext, enables a new sync connection,
or resumes an intentionally paused connection.

The current device keeps access. Other devices stop syncing and request the latest
recovery key. They retain their local finances, pending edits and history pins.
Older encrypted history remains readable using a key archive encrypted under the
new key. New mutations use the new key. The original key is retained for stable
opaque record IDs, so existing records are updated rather than duplicated.

Rotation protects **future changes** from someone holding only an older key.
It cannot erase copies of old keys, plaintext or ciphertext, make old ciphertext
secret again, or revoke authentication. Revoke a lost/untrusted device separately
in Manage devices. Unchanged historical records are not rewritten or deleted.

Prepare a replacement after syncing the initiating device. If another device
changes cloud history or rotates first, the server rejects the stale replacement.
The app keeps the pending replacement available for retry or cancellation. Cancel
checks the server first; a request that actually committed is acknowledged rather
than undone. A new prepared key expires from native memory after ten minutes.

**Get verification code** downloads and checks encrypted history against this
device's saved checkpoint, then displays an `HDV1` code. Transfer that code directly
to the new device and enter it with the recovery key. It binds the service origin,
account, dataset, current key package and verified history checkpoint. It contains
no encryption key. A code is a minimum-history anchor at the time of export, not a
promise that no other device has written since. Generate a fresh code after any
rotation. It is not a cryptographic device enrollment certificate or a global
transparency log.
Generating a fresh code reads encrypted history and requires current sync access.
Key replacement and recovery themselves use the key API and do not require a paid
subscription; expiry still blocks financial push/pull/snapshot.

If all trusted devices/codes are lost, recovery is allowed only after a separate
unchecked-by-default acknowledgment that the server could return old/incomplete
history. The warning remains visible and persists through sign-out, key removal,
restart and rotation. New local checkpoints still detect later rollback. A code
exported from that device carries the warning in its authenticated contents; it
cannot silently promote recovery to independently verified history. A later code
from an independently trusted device can clear the warning if it agrees with or
extends the existing pin. Recovery never weakens an existing pin, including when
the user accepts the warning.

## Wire protocol and storage

Apply additive PostgreSQL migration `0009_key_rotation.sql`. Existing migrations
and existing `heyday-key-v1` recovery envelopes are unchanged. GET keys returns
`{ datasetId, key, rotation, keyManagementVersion: 2 }`. Initial PUT enrollment is
still immutable/idempotent and cannot replace an existing package. POST to
`/api/v1/encryption/keys` accepts exactly:

```ts
{
  format: 'heyday-rotation-v1',
  previousKey: KeyEnvelope,
  key: KeyEnvelope,
  head: { sequence: string, hash: string },
  history: { salt: string, nonce: string, ciphertext: string },
  proof: string
}
```

All key operations require a verified native token and an active registered
device, without requiring a subscription. The server serializes rotation with
device revocation and sync under the same account transaction lock. It compares
the exact previous package and current history head, forbids key-ID reuse, and
atomically replaces the current package with an immutable rotation receipt.
Identical retries return current state. Replaying an older receipt never rolls back
a newer rotation. Server authorization is account/device authorization: the server
cannot verify the client MAC or possess the data key. A stolen account session can
attempt a destructive invalid replacement, but pinned clients reject it; this
remains an availability threat, not support recovery or plaintext access.

Sync clients advertise `X-Heyday-Keys: 2` separately from entity protocol 5.
After rotation, older clients receive `CLIENT_UPGRADE_REQUIRED`. A new write with
an obsolete key receives `KEY_CHANGED`. An exact previously accepted mutation
still returns its original receipt, even under an older key. Only that definitive
rejection permits a newer client to discard obsolete pending ciphertext; local
dirty revisions remain queued and are encrypted again after pulling history.
Entitlement and retention behavior are unchanged.

PostgreSQL holds recovery wrappers, public parameters, encrypted archives and
rotation receipts. The native credential entry holds the current root, package
pin, checkpoint, recovery-warning flag and optionally one pending root. It does
not grow with the historical key archive. Before POST, the client atomically saves
the exact public/encrypted rotation request under an origin/account/build-scoped
`cloud-key-packages` path and pins its hash plus the pending root in the OS store.
Raw keys never enter that file, SQLite, financial backups, logs or web storage.
Confirmed rotation preserves the remember-key preference. Explicit key removal
and device forgetting erase both usable roots while retaining pins/retry metadata.

## Cryptographic construction

Existing recovery wrapping and record-v2 derivation remain unchanged. Let `E(e)`
be the compact JSON array
`[format,algorithm,kdf,datasetId,keyId,salt,nonce,ciphertext]` for a recovery envelope.
All string encodings and unpadded base64url remain canonical.

The archive plaintext is an ordered JSON array of
`{ envelope, key, until: { sequence, hash }, pin }` for every earlier epoch. Each `key`
is its 32-byte root encoded as base64url. The last item is the previous package,
with `until` equal to the rotation head. Boundaries are nondecreasing and equal
sequences must have equal hashes. IDs are unique. A rotation with no intervening
mutations may share the preceding boundary.
Each `pin` is that epoch's complete package fingerprint, including its then-current
archive. A recovering device requires its previous exact package pin in the new
archive; matching only an envelope/key ID is insufficient.

Archive AES-256-GCM key:

- HKDF-SHA256 IKM: new independent 32-byte root.
- Salt: fresh 32-byte archive salt.
- Info: compact UTF-8 JSON `["heyday-key-history-v1",accountId,datasetId,newKeyId]`.
- AAD: `["heyday-key-history-v1",accountId,E(newEnvelope)]`.
- Fresh 12-byte nonce and 16-byte tag. The exact ciphertext is reused on retry.

Control MAC key: HKDF-SHA256 of the relevant epoch root, empty salt, and literal
UTF-8 info `heyday-control-mac-v1`. The transition proof is HMAC-SHA256 using the
previous root's control MAC key over:

```text
["heyday-rotation-v1",accountId,E(previousEnvelope),E(newEnvelope),
 head.sequence,head.hash,history.salt,history.nonce,history.ciphertext]
```

The rotation fingerprint is SHA-256 of compact JSON
`[base64url(transitionProofInput),proof]`. A nonrotated key's fingerprint is
SHA-256 of `["heyday-key-pin-v1",accountId,E(envelope)]`.

The history-code body contains `origin`, `account`, `dataset`, `keyPin`, `head`,
`unverifiedHistory`, and `mac`. Its MAC uses the current root's control MAC key over
`["heyday-history-proof-v1",origin,account,dataset,keyPin,head.sequence,head.hash,unverifiedHistory]`.
The code is `HDV1.` followed by base64url of its UTF-8 JSON. Consumers compare the
full context and use constant-time MAC verification, not the human-readable prefix.

Clients select record decryption/MAC keys by authenticated sequence boundaries,
not simply by a caller-provided key ID. Boundary hashes and the previous head of
the first subsequent mutation must match. Past epochs cannot authenticate new
writes. Stable record-ID HMACs continue to use the original root and key ID.

When SQLite is behind a pinned checkpoint or rotation boundary, the client checks
the complete required prefix before applying any downloaded financial data.
Staged pages contain only ciphertext and are discarded on failure; decoded values
are validated again when applying. A crash between secure-store pinning and SQLite
commit can be repaired by replay, without lowering the secure-store checkpoint.

Parsing is bounded: 128 KiB archive ciphertext, 192 KiB rotation requests/responses,
2 KiB history-code decoded body. History verification stages at most 512 MiB and
8,192 pages before a clear update-required error. These are implementation safety
bounds, not subscription quotas. Compaction and larger-history streaming need a
future protocol change; nothing is pruned automatically.

Primitives follow the existing [HKDF context separation guidance](https://www.rfc-editor.org/rfc/rfc5869.html)
and [AES-GCM specification](https://csrc.nist.gov/pubs/sp/800/38/d/final).
Those references do not constitute a security review of this protocol.

## Verification and rollout

Public deterministic vectors are shared between the independent desktop and site
repositories. Rust and Web Crypto decrypt the same archive and verify the same
transition proof. Tests cover old/new roots, stable IDs, multiple rotations,
tampering, origin/account substitution, warning propagation, stale pins, late-page
forks, ciphertext-only staging, API races, retries, rollback, revoked access,
subscription expiry and UI recovery/consent.

Deploy the migration and updated API before distributing a desktop that rotates
keys. A new client refuses rotation when the service does not advertise key
management version 2. Do not restore an older service database or key table in
isolation; immutable histories, receipts, current packages and sync heads belong
to the same transactional backup. Installed macOS/Windows keychain, interrupted
network and two-device upgrade/rotation tests are still release QA. No real
customer keys or datasets are rotated by automated tests or deployment.
