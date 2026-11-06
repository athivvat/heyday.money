# End-to-end encryption: setup, recovery and rotation

Implemented: native key generation, recovery-key confirmation/export, immutable
encrypted-key storage, recovery on a registered device, local locking, and native
record-encryption helpers. [Category sync](sync-api.md) now connects native record
v2 encryption to a durable queue with separate explicit enablement. Desktop beta.5 also syncs accounts, atomic transaction groups, income/deduction definitions, complete payslips and source-linked monthly income forecasts;
protocol 5 also covers all remaining financial metadata, planner settings, loan definitions, reconciliation history and logos. SQLite and backups remain local plaintext databases;
exports/restores strip device-local sync bookkeeping and require explicit reconnect.

Personal financial analysis and credit scoring remain future product work. Any
server-readable disclosure needs a separate, explicit permission flow identifying
purpose, fields, recipients, duration, retention and withdrawal behavior. Enabling
E2EE or signing in is not permission for that disclosure. No analytics key escrow,
plaintext export endpoint, support recovery key or consent mechanism is added here.

## User flow

1. Sign in with email and register the installation under **Manage devices**.
2. Choose **Cloud sync → Set up encryption**. Rust creates a dataset key
   and a separate random recovery key. The recovery key is shown for up to ten
   minutes, with an optional native file save and password-manager guidance.
3. Save it, re-enter it and confirm that support cannot recover a lost key.
   Only then does the client save the key in the OS credential store and upload
   its encrypted package. A cancelled initial setup sends no key package.
4. Another registered device requires the saved recovery key to unlock. Email
   authentication authorizes access to the encrypted package, not decryption.
   The app shows **Restore encryption key** only when this device needs recovery.
5. **Remember encryption on this device** retains the account-scoped dataset key
   in the OS secure store through ordinary sign-out. Setup/recovery offers this
   choice and unlocked devices can change it. Existing entries default to off.
   The next sign-in reconnects the saved installation; server device access and
   the pinned key package are checked before using the retained key.
6. **Advanced security → Remove saved encryption key**, **Sign out and forget this
   device**, self-revocation and detected invalid
   authentication remove the usable key and remember flag, preserving the accepted
   package pin and history checkpoint. Ordinary sign-out also removes the key when
   remembering is off. Forgetting disables automatic device reconnection until an
   explicit registration, retaining the stable installation ID. Auth tokens are
   always removed. An unavailable secure store reports failure; there is no plaintext
   file fallback. Local financial records remain available.

Everyday controls are **Pause sync / Resume sync** beside an **End-to-end encrypted**
badge. Pausing keeps the key saved. Key removal lives under collapsed Advanced
security and must pause sync successfully before deleting the usable local key.
Recovery preserves an intentional pause; resuming a complete, previously approved
connection does not repeat the initial consent dialog. New or expanded financial
sync still requires confirmation.

The user-selected recovery file is **plaintext secret material**. It is created
exclusively (no overwriting existing paths), with owner-only permissions on Unix.
Keep it separately from the computer. Recovery keys are not included in financial
backups, browser storage, API requests or application logs. The React process sees
the recovery text for display/input, but never the raw dataset key. Native secret
buffers are cleared when dropped where supported; this is not a guarantee against
malware, memory inspection or copies retained by the OS/JavaScript runtime.

## Cryptographic format

All randomness comes from the operating system. The dataset key and recovery key
are independent 32-byte random values. The recovery string is
`HDK1.<base64url recovery bytes>.<checksum>` where checksum is the first four bytes
of SHA-256(recovery bytes), encoded as eight lowercase hex characters. The checksum
detects transcription mistakes; it is not authentication. Surrounding whitespace
is trimmed; other noncanonical formats are rejected. This is a high-entropy key,
not a user password, so HKDF is used rather than a password-hardening KDF.

The key package contains exactly:

| Field | Value |
| --- | --- |
| `format` | `heyday-key-v1` |
| `algorithm` | `A256GCM` |
| `kdf` | `HKDF-SHA256` |
| `datasetId` | The authenticated account's lowercase UUID |
| `keyId` | Opaque ID; native client generates 32 random bytes encoded as base64url |
| `salt` | 32 random bytes, base64url |
| `nonce` | 12 random bytes, base64url |
| `ciphertext` | Encrypted 32-byte dataset key followed by a 16-byte GCM tag, base64url |

Base64url is unpadded and canonical. Derive a 32-byte AES wrapping key using
HKDF-SHA256 with recovery bytes as IKM, the package salt, and UTF-8 compact JSON
info in this exact order:

```json
["heyday-recovery-v1","accountId","datasetId","keyId"]
```

AES-256-GCM associated data is UTF-8 compact JSON in this exact order:

```json
["heyday-key-v1","A256GCM","HKDF-SHA256","accountId","datasetId","keyId","salt"]
```

Identifiers come from the authenticated account and expected dataset. Wrong keys,
changed context or invalid authentication tags fail without returning plaintext.
Rust uses [RustCrypto AES-GCM](https://docs.rs/aes-gcm/0.10.3/aes_gcm/) and
[HKDF](https://docs.rs/hkdf/0.12.4/hkdf/). A public test vector is independently
decrypted by Rust and Web Crypto, including Unicode and exact monetary text.

Native-only record helpers implement the existing `heyday-record-v1` envelope and
associated-data contract in [cloud-sync.md](cloud-sync.md). They use the dataset
key with a fresh random 96-bit nonce and a 128-bit GCM tag. Maximum ciphertext is
65,536 bytes including the tag; maximum plaintext is 65,520 bytes. These legacy
helpers are not exposed through IPC or accepted by the sync API. Active category
sync uses record v2, independently derived keys per mutation, 8,192-byte category / 262,144-byte ledger ciphertext
bounds and a MAC-authenticated history. See [the exact construction](sync-api.md).

## API and persistence

`GET /api/v1/encryption/keys` and `PUT /api/v1/encryption/keys` require a verified
native access token and an active registered session/device. They use the existing
account rate limit and private/no-store responses. No premium entitlement is
required for key management; these endpoints cannot retrieve financial records.

GET returns `{ datasetId, key: KeyEnvelope | null, rotation, keyManagementVersion: 2 }`. PUT accepts the exact initial key
package above (`application/json`, maximum 4,096 bytes) and returns the same shape
with the accepted package. The owner is derived from authentication. Unknown
fields, including raw/recovery keys or plaintext financial fields, are rejected.

The first valid package wins under the account transaction lock. Identical PUT
retries return 200; a different package returns `CONFLICT` (409), without replacing
the original. Unregistered sessions get `DEVICE_REQUIRED` (403); expired/revoked
sessions cannot read or write. `/me` advertises `keyEnrollment: true` and returns
`dataset.keyStatus` as `not_enrolled` or `enrolled`. That status indicates package
storage, not proof that every device possesses the decryption key.

Migration `0002_encryption_keys.sql` stores one package per account/dataset with
owner/dataset foreign keys. PostgreSQL stores ciphertext, public cryptographic
parameters and account/device metadata, including email and activity. It never
receives the raw dataset or recovery keys. TLS and infrastructure encryption at
rest remain necessary for metadata and credentials.

The native client stores a versioned entry scoped by origin, account ID and build
mode in `money.heyday.desktop.encryption[.development]`. It contains the root key,
exact package, confirmation flag and highest verified sync checkpoint. The
checkpoint survives local locking/sign-out and is preserved when recovering the
same package. A crash can leave it ahead of SQLite; verified history replay repairs
that gap without clearing the checkpoint. The root key is saved **before** PUT so a
crash/lost response can resume the same package with the already saved recovery
key. A subsequent GET of that exact package acknowledges a lost response. Neither
network errors nor restart generate replacement keys automatically.

Once confirmed, an unexpected/missing remote package or changed dataset is blocked,
even after locking/signing out, because the package pin remains. If competing
first-time setup wins before this client confirms, explicit recovery can adopt
that winning package. Versioned replacement now uses POST on the same endpoint,
with a new root, encrypted historical-key archive and exact-head compare-and-swap.
Other devices require the new recovery key; they validate the archive against their
existing package/checkpoint. See [the full rotation protocol](key-rotation.md).

New devices accept a history code transferred directly from a trusted device, then
verify the complete anchored prefix before applying financial data. If all trusted
devices/codes are lost, the user must separately accept unverified recovery; its
warning persists and propagates in exported codes. Existing pins are never erased
by that choice. This is not global freshness consensus or device-key enrollment.

## Remaining before financial sync release

- Obtain an independent review of the per-mutation and key-rotation constructions;
  the [review brief](security-review.md) is prepared, not a completed audit.
- Complete packaged two-device setup, rotation, key replacement, recovery,
  interrupted requests and real macOS/Windows credential-store tests.
- A transferred checkpoint detects rollback/forks of the verified prefix, not
  all global equivocation or later withheld writes. Unverified recovery explicitly
  accepts the missing independent baseline and retains its warning.
- Revocation prevents future API access, but cannot erase old keys or data held by
  another device. Cryptographic device enrollment/approval is not implemented.

Automated coverage: Rust wrapping/tampering/recovery/record bounds, a standard
AES-GCM vector and Rust/Web Crypto interoperability; PostgreSQL concurrent setup,
idempotency, ownership and revoked access; browser confirmation, wrong-key errors,
interrupted setup, expiry, local locking and English/Thai flows. Browser tests mock
native IPC and do not replace real credential-store testing.
