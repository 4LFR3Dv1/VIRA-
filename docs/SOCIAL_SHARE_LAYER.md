# VIRA Social Share Layer

The social layer turns the existing competitive loop into acquisition and group retention without adding a social graph.

## Canonical identities

- `publicId`: stable identity across public VIRA experiences. Ownership is proven by a high-entropy opaque browser token; only its hash is persisted.
- `participantId`: identity inside one room. It is linked to a `publicId` only after authenticated admission.
- `sessionToken`: private room authority. It is never stored in a share, public page, analytics event, or Mini League.

## Slice 1: Room Invite

An authenticated room participant creates a `RoomShareCard`. The server derives fixture metadata and an internal CTA; the client cannot submit arbitrary metadata or destinations. `/s/:publicCode` exposes Open Graph metadata, records an open, and preserves the invite code when the visitor enters the room. Admission creates an idempotent participant/public-identity link and attribution record.

## Slice 2: Result Share

A result card can only be created from an authenticated participant snapshot after a round resolution exists. It contains only that participant's resolved outcome, points and aggregate rank. No current or foreign individual answer is exposed. Its CTA returns to the same fixture for the next round or finished match.

## Slice 3: Prediction 1X2

Before kickoff, a public identity can choose `home`, `draw`, or `away`. One prediction exists per fixture and public identity; it may be changed only while open. Kickoff locks creation. Once the fixture is officially finished, the server resolves every prediction from the room's authoritative final score.

## Slice 4: Mini League

Every room or prediction share creates an implicit Mini League. Opening a link does not make someone a member; authenticated admission does. Membership is idempotent and the ranking is a filtered projection of the existing room leaderboard. Mini League does not own points and cannot mutate competitive results.

## Invariants

1. Clients send references, never social metadata or external destinations.
2. Every share has an allowlisted internal CTA.
3. Public, room and session identities remain distinct.
4. Individual choices remain private before competitive lock.
5. A social image failure cannot prevent link creation or admission.
6. The share preserves creation-time metadata while its destination continues to read live room state.
7. Analytics tracks `share_created`, `share_opened`, `share_cta_clicked`, `identity_admitted`, `room_joined_from_share`, and attributed `round_answered`.
8. Mini League is an attribution projection, not another scoring system.

## Persistence

The single-replica deployment persists the social projection atomically at `${VIRA_DATA_DIR}/social.json`, on the same Railway volume policy used by the event ledger. Writes are serialized and survive process restart.

## Public gate

```text
participant creates invite
-> crawler receives VIRA Open Graph metadata
-> friend opens /s/:code
-> CTA preserves invite attribution
-> friend joins the same room
-> membership is created once
-> friend answers
-> round_answered is attributed to the share
-> group ranking reuses the authoritative leaderboard
```
