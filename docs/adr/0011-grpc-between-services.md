# ADR-0011: Use gRPC for synchronous calls between services

- **Status:** Accepted
- **Date:** 2026-11-15

## Context

A food entry in the diary copies the food's name and nutrients from the catalog when it
is logged ([ADR-0010](0010-goals-and-diary-in-one-service.md)), so the diary needs the
catalog's data while the user waits. This is the first call from one service to
another; until now, only clients called services, through the gateway.

The call is internal: no browser makes it and it never passes the gateway. It needs a
contract both services build against, a limit on how long the caller waits, and errors
the caller can act on (no such food vs. catalog down). How services call each other
has to be settled before the diary's food entries depend on it, and later internal
calls will follow the same pattern.

Which foods a read may return depends on the user: public foods for anyone, private
foods (user-created foods and private copies) only for their owner. The catalog's REST
API learns the user from the access token, which is optional for reads. A food entry
for the user's own custom food is a core case, so the call has to carry the user too.

## Considered options

1. **REST/JSON, reusing the catalog's public API** (`GET /v1/foods/{id}`).
   - Pros: nothing new to build or run; easy to call with curl.
   - Cons:
     - The contract is loose: the diary hand-writes types and parsing, and nothing
       checks that a catalog change keeps the diary working.
     - Internal needs (fields, batch reads) would leak into the public API.
2. **gRPC with a Protobuf contract.**
   - Pros:
     - One `.proto` file generates the server and client types; numbered fields let
       the contract grow without breaking old clients, and `buf breaking` checks it.
     - Deadlines travel with every call, and both sides cancel when time runs out.
     - Standard status codes (`NOT_FOUND`, `UNAVAILABLE`, `DEADLINE_EXCEEDED`) map
       directly to what the caller does.
   - Cons:
     - New tooling: Protobuf, code generation, a second port on the catalog.
     - Binary on the wire: harder to inspect by hand than JSON.
     - Browsers can't call it directly (not needed here).
3. **Asynchronous only: the diary keeps a copy of the catalog, updated by events.**
   - Pros: logging works while the catalog is down.
   - Cons: a copy of every food in the diary to keep in sync, for a read the user
     makes a few times a day; a just-created food may not be there yet.

## Decision

We will use **gRPC** for synchronous calls between services, because the contract is
checked in CI, and deadlines and status codes give the failure behavior an interactive
call needs. Practicing gRPC is also a goal of this project
([roadmap](../roadmap.md)); option 1 would work at this size.

- **Contract:** `.proto` files in a library per owning service (`libs/catalog/grpc`),
  linted and checked for breaking changes with **buf**, TypeScript types generated
  with **ts-proto**. CI checks the generated code is current, like `openapi.json`.
- **Server:** the catalog serves HTTP and gRPC from one process, gRPC on its own port
  that the gateway never routes.
- **First call:** `GetFood(id, languages)` returns the name in the first of the
  user's languages it has, the brand, basis (g or ml) and values per 100.
- **Authentication:** the diary forwards the user's access token in the call's
  metadata (`authorization`), and the catalog verifies it exactly as for REST. So
  `GetFood` returns public foods and the user's own private ones, and `NOT_FOUND` for
  someone else's, even if the gRPC port were reachable by mistake: nothing is trusted
  without identity's signature. A forwarded token proves the user, not which service
  calls. When a call needs the service's own identity (a call made with no user, or a
  write between services), that service will get its own token (OAuth client
  credentials) or exchange the user's token for a narrower one (RFC 8693 token
  exchange).
- **Failure:** the diary allows 1 s in total, including one retry on `UNAVAILABLE`
  (safe: the read can be repeated). The client can always tell a missing food from a
  catalog problem:

  | Catalog result                   | Diary responds                 | Client should          |
  | -------------------------------- | ------------------------------ | ---------------------- |
  | `NOT_FOUND`                      | `422`, "No such food"          | not retry; pick again  |
  | `UNAVAILABLE` (after the retry)  | `503`, "Catalog unavailable"   | retry later            |
  | `DEADLINE_EXCEEDED` (1 s passed) | `504`, "Catalog didn't answer" | retry later            |
  | anything else (`INTERNAL`, …)    | `502`, "Catalog failed"        | retry later, or report |

  In every failure case the entry is not logged. Reading the diary never calls the
  catalog, so a catalog outage only blocks logging new foods.

## Consequences

**Positive**

- A catalog change that would break the diary fails CI, not production.
- A slow catalog costs the user at most about 1 s, and the catalog stops work nobody
  waits for.
- A missing food and a catalog problem get different statuses, so clients and alerts
  never confuse them.
- Internal calls have one pattern for contracts, deadlines and errors.

**Negative**

- Protobuf, buf and generated code to learn and maintain, next to OpenAPI.
- While the catalog is down, foods can't be logged (manual entries still work).
- The catalog trusts any holder of a valid user token, as its REST API already does:
  it can't tell the diary from another caller. Service identity comes later.

**Follow-ups**

- Phase 3 Step 6: trace the call across both services; a catalog SLO for `GetFood`
  well below the diary's deadline, alerting before callers see errors.
- Kubernetes: NetworkPolicy so that only the diary can reach the gRPC port; consider
  mTLS.
- The first RPC that needs the calling service's identity: client-credentials tokens
  or token exchange from identity.
