# diary-events

The events the diary publishes to Kafka, for other services
([ADR-0012](../../../docs/adr/0012-kafka-events-with-outbox.md)). The contract is the
`.proto` file in [proto/](proto/fitadel/diary/v1/food_logged.proto); the TypeScript in
`src/generated` is generated from it and committed, with `encode` and `decode` for the
message bytes.

| Topic               | Key       | Message      | Published when                               |
| ------------------- | --------- | ------------ | -------------------------------------------- |
| `diary.food-logged` | `food_id` | `FoodLogged` | a food entry is logged or copied (no manual) |

`FoodLogged` carries no user: consumers learn what is logged, not who logs it.

- Delivery is **at least once**: the same event can arrive twice. Consumers skip an
  `event_id` they have already processed.
- Events from one food arrive in order (one key, one partition); events from different
  foods may interleave.

```ts
import { FOOD_LOGGED_TOPIC, FoodLogged } from '@fitadel/diary-events';

const bytes = FoodLogged.encode(event).finish();
const decoded = FoodLogged.decode(bytes);
```

## Changing the contract

Consumers built against the old contract keep reading while you deploy, and old events
stay in the topic, so changes must be backward compatible: the same rules as
[catalog-grpc](../../catalog/grpc/README.md#changing-the-contract). A real break needs a
new message on a new topic.

| Target                               | What it does                                                         |
| ------------------------------------ | -------------------------------------------------------------------- |
| `nx run diary-events:proto-generate` | regenerate `src/generated` (CI checks it's current)                  |
| `nx run diary-events:proto-lint`     | buf lint (part of `nx lint diary-events`)                            |
| `nx run diary-events:proto-breaking` | buf breaking: changes that would break old consumers, against `main` |
