# catalog-grpc

The catalog's gRPC contract, for other services
([ADR-0011](../../../docs/adr/0011-grpc-between-services.md)). The contract is the
`.proto` file in [proto/](proto/fitadel/catalog/v1/food_service.proto); the TypeScript in
`src/generated` is generated from it and committed, so a change to the contract shows
its effect in review.

| Service       | RPC       | Does                                                                    |
| ------------- | --------- | ----------------------------------------------------------------------- |
| `FoodService` | `GetFood` | a public food or one of the user's own, with its values per 100 g or ml |

Calls carry the user's access token in the `authorization` metadata.

## Changing the contract

Clients built against the old contract keep running while you deploy, so changes must
be backward compatible:

- Add fields with new numbers. Never reuse or renumber a field, or change its type:
  the number, not the name, identifies a field on the wire.
- To remove a field, mark its number `reserved`.
- A real break needs a new package (`fitadel.catalog.v2`) next to `v1`.
- A field whose "unknown" differs from `0` (or `""`) must be `optional`.

| Target                               | What it does                                                       |
| ------------------------------------ | ------------------------------------------------------------------ |
| `nx run catalog-grpc:proto-generate` | regenerate `src/generated` (CI checks it's current)                |
| `nx run catalog-grpc:proto-lint`     | buf lint (part of `nx lint catalog-grpc`)                          |
| `nx run catalog-grpc:proto-breaking` | buf breaking: changes that would break old clients, against `main` |
