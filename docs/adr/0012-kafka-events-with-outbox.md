# ADR-0012: Use Kafka with a transactional outbox for events between services

- **Status:** Accepted
- **Date:** 2026-11-22

## Context

The diary now logs foods from the catalog ([ADR-0011](0011-grpc-between-services.md)).
The catalog could rank foods better if it knew which ones people actually log: a food
logged a thousand times in Fitadel should come before one nobody picks. The diary has
that knowledge; the catalog needs it eventually, not while the user waits. A
synchronous call for it would make logging depend on the catalog a second time, for
something that isn't the user's business.

This is the first event between services. Two writes are involved, and no transaction
spans both: the entry in the diary's database and the message to the other service.
Committing first and then sending loses the event when the process dies in between;
sending first announces an entry whose commit may still fail. The pattern chosen here
will carry later events too.

What the events feed is a ranking hint, not app logic: nothing breaks without them.
Running a message broker costs money in the cloud, so turning events off must stay an
option that needs no code change.

## Considered options

1. **Kafka, with a transactional outbox in the publishing service.**
   - Pros:
     - A durable, replayable log: a consumer that was down catches up from its offset,
       and a new consumer can read history.
     - Partitions by key keep one food's events in order and let consumers scale out.
     - The outbox makes the entry and its event commit together.
   - Cons:
     - The heaviest option to run: a broker to operate locally and pay for in the
       cloud.
     - At-least-once delivery: consumers must handle duplicates.
     - A relay and an outbox table to build.
2. **A lighter broker (RabbitMQ or NATS JetStream), with the same outbox.**
   - Pros: less to run, enough for one event type at this size.
   - Cons: queues rather than a replayable log (JetStream has streams, but a smaller
     ecosystem); the same outbox work either way.
3. **No broker: Postgres `LISTEN/NOTIFY`, or the catalog polling the diary.**
   - Pros: nothing new to run.
   - Cons: notifications are lost while the listener is down, and polling couples the
     catalog to the diary's database or API, the coupling ADR-0010 avoids between
     services.
4. **Change data capture (Debezium reading the diary's write-ahead log) instead of an
   outbox written by code.**
   - Pros: no outbox code in the service.
   - Cons: Kafka Connect and Debezium to run as well, and the database's row layout
     becomes the event contract unless an outbox table is used anyway.

## Decision

We will publish events between services to **Kafka**, written through a
**transactional outbox**, because it solves the dual write with one table and gives a
replayable log consumers can catch up from. Kafka is chosen deliberately to practice it
([roadmap](../roadmap.md)); at this size, option 2 would work as well.

- **First event:** `FoodLogged { event_id, food_id, logged_at }`, recorded when a food
  entry is logged or copied. It carries no user id: the catalog needs to know what is
  logged, not who logs it. Changing or deleting an entry records nothing.
- **Topic and key:** `diary.food-logged`, keyed by `food_id`, so one food's events stay
  in one partition, in order.
- **Contract:** Protobuf in a library per publishing service (`libs/diary/events`),
  with the same buf lint, breaking checks and generated-code check as the gRPC contract
  (ADR-0011). No schema registry: the contract is versioned in the repository.
- **Outbox:** the diary writes the event to an `outbox_event` table in the same
  transaction as the entry, so both commit or neither does. A relay in the diary
  publishes unsent rows and marks them sent. It claims rows with
  `FOR UPDATE SKIP LOCKED`, so replicas never publish the same row at once. Sent rows
  are deleted after a day.
- **Delivery:** at least once; a crash between publishing and marking sends the event
  again. The catalog consumes in its own consumer group and is idempotent: it records
  each `event_id` in the same transaction as its count, and skips an event it has seen.
- **What the catalog does:** it counts logs per food in Fitadel, separate from
  `popularity` (imported from Open Food Facts), and may use the count in ranking.
- **Client:** `@platformatic/kafka`, a maintained client written in TypeScript with no
  native build. `kafkajs` has had no release since 2023; Confluent's client wraps
  librdkafka, a native module to build on every machine.
- **Local:** one broker in KRaft mode (no ZooKeeper) in `compose.yaml`. No cloud
  cluster yet.
- **Events can be switched off:** `EVENTS_ENABLED=false` in a service turns its events
  off, with no Kafka needed:
  - The diary records events through an interface; switched off, a version that does
    nothing is used, and no relay or Kafka client starts. Nothing is written to the
    outbox, so it can't grow without a relay.
  - The catalog doesn't start its consumer; counts stop growing and ranking works
    without them.
  - Health checks never depend on Kafka. With events on and Kafka down, logging still
    works and the outbox keeps the events until Kafka is back.

## Consequences

**Positive**

- An entry and its event can't disagree: both are committed, or neither.
- Logging never waits for Kafka or the catalog's consumer; a Kafka outage delays
  events, it doesn't lose them.
- One switch per service turns events off, and an environment can run without a broker.
- Later events reuse the outbox, the relay and the contract library.

**Negative**

- Kafka to run locally and, later, to pay for in the cloud.
- At-least-once delivery: every consumer has to be idempotent.
- The catalog's counts lag behind the diary, by seconds normally and more during an
  outage.
- While events are switched off, nothing is recorded: the counts cover only the time
  they were on. Acceptable for a ranking hint, not for anything the app must get right.
- A young client library with frequent releases: pinned to exact versions, upgraded on
  purpose.

**Follow-ups**

- Phase 3 Step 6: trace a log from the diary through Kafka to the catalog (trace
  context in message headers); alert on outbox lag and consumer lag.
- A dead-letter topic for events the consumer can't process, once there is one.
- Cloud: managed Kafka (cost stated first) or events off in that environment.
