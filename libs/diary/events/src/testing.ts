import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import {
  Admin,
  Consumer,
  type Message,
  ProduceAcks,
  Producer,
} from '@platformatic/kafka';
import {
  GenericContainer,
  type StartedTestContainer,
  Wait,
} from 'testcontainers';
import { FOOD_LOGGED_TOPIC, FoodLogged } from './index';

/**
 * The same Kafka as compose.yaml, compiled ahead of time (GraalVM): it starts in about
 * a second and needs far less memory. Fine for tests, not meant for production.
 */
const IMAGE =
  'apache/kafka-native:4.4.0@sha256:11fde816adf384402de9f3e57aeaf2c3722ba0671610247817688d07441714b4';

/** How long to keep listening once the expected events arrived, to catch extra ones */
const SETTLE_MS = 1_000;

export interface ReceivedFoodLogged {
  key: string;
  partition: number;
  event: FoodLogged;
}

/**
 * A real Kafka broker in a container, with the diary's topic, for integration tests.
 * Its host port is chosen before it starts: a client connects to the address the
 * broker advertises, so the broker must know the port the host sees.
 */
export class TestKafka {
  private constructor(
    private readonly container: StartedTestContainer,
    private readonly port: number,
  ) {}

  get brokers(): string[] {
    return [`localhost:${this.port}`];
  }

  static async start(): Promise<TestKafka> {
    const port = await freePort();
    const container = await new GenericContainer(IMAGE)
      .withExposedPorts({ container: port, host: port })
      .withEnvironment({
        CLUSTER_ID: 'LEEip9wf5ZZ_R6pxEAqbpA', // any 16 bytes, base64url
        KAFKA_NODE_ID: '1',
        KAFKA_PROCESS_ROLES: 'broker,controller',
        KAFKA_CONTROLLER_QUORUM_VOTERS: '1@localhost:9093',
        KAFKA_LISTENERS: `HOST://:${port},CONTROLLER://:9093`,
        KAFKA_ADVERTISED_LISTENERS: `HOST://localhost:${port}`,
        KAFKA_LISTENER_SECURITY_PROTOCOL_MAP:
          'HOST:PLAINTEXT,CONTROLLER:PLAINTEXT',
        KAFKA_INTER_BROKER_LISTENER_NAME: 'HOST',
        KAFKA_CONTROLLER_LISTENER_NAMES: 'CONTROLLER',
        KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: '1',
        KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR: '1',
        KAFKA_TRANSACTION_STATE_LOG_MIN_ISR: '1',
        KAFKA_AUTO_CREATE_TOPICS_ENABLE: 'false',
        KAFKA_GROUP_INITIAL_REBALANCE_DELAY_MS: '0',
      })
      .withWaitStrategy(Wait.forLogMessage(/Kafka Server started/))
      .start();
    const kafka = new TestKafka(container, port);
    await kafka.admin((admin) =>
      admin.createTopics({
        topics: [FOOD_LOGGED_TOPIC],
        partitions: 3,
        replicas: 1,
      }),
    );
    return kafka;
  }

  /** Stops the broker, keeping its data and port: clients see Kafka go down */
  stopBroker(): void {
    execFileSync('docker', ['stop', this.container.getId()], {
      stdio: 'ignore',
    });
  }

  /** Starts it again and waits until it answers */
  async startBroker(): Promise<void> {
    execFileSync('docker', ['start', this.container.getId()], {
      stdio: 'ignore',
    });
    const deadline = Date.now() + 30_000;
    for (;;) {
      try {
        await this.admin((admin) => admin.listTopics());
        return;
      } catch (error) {
        if (Date.now() > deadline) throw error;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
  }

  /** Publishes messages to the diary's topic as they are, valid FoodLogged or not */
  async publish(messages: { key: string; value: Uint8Array }[]): Promise<void> {
    const producer = new Producer({
      clientId: 'test-publisher',
      bootstrapBrokers: this.brokers,
    });
    try {
      await producer.send({
        acks: ProduceAcks.ALL,
        messages: messages.map(({ key, value }) => ({
          topic: FOOD_LOGGED_TOPIC,
          key: Buffer.from(key),
          value: Buffer.from(value),
        })),
      });
    } finally {
      await producer.close();
    }
  }

  /**
   * The FoodLogged events on the topic that match, read from the start by a new
   * consumer group: once `expected` of them arrived, it listens a moment longer for
   * extra ones, so a duplicate shows up as one too many.
   */
  async foodLogged(
    expected: number,
    matches: (event: FoodLogged) => boolean = () => true,
    timeoutMs = 20_000,
  ): Promise<ReceivedFoodLogged[]> {
    const consumer = new Consumer({
      clientId: 'test-reader',
      groupId: `test-reader-${randomUUID()}`,
      bootstrapBrokers: this.brokers,
    });
    const received: ReceivedFoodLogged[] = [];
    try {
      const stream = await consumer.consume({
        topics: [FOOD_LOGGED_TOPIC],
        mode: 'earliest',
        autocommit: false,
      });
      let stopAt = Date.now() + timeoutMs;
      const timer = setInterval(() => {
        if (Date.now() >= stopAt) void stream.close();
      }, 100);
      try {
        for await (const message of stream as AsyncIterable<Message>) {
          const event = FoodLogged.decode(message.value);
          if (!matches(event)) continue;
          received.push({
            key: message.key.toString(),
            partition: message.partition,
            event,
          });
          if (received.length === expected) {
            stopAt = Math.min(stopAt, Date.now() + SETTLE_MS);
          }
        }
      } finally {
        clearInterval(timer);
      }
    } finally {
      await consumer.close(true);
    }
    return received;
  }

  async stop(): Promise<void> {
    await this.container.stop();
  }

  private async admin<T>(work: (admin: Admin) => Promise<T>): Promise<T> {
    const admin = new Admin({
      clientId: 'test-admin',
      bootstrapBrokers: this.brokers,
    });
    try {
      return await work(admin);
    } finally {
      await admin.close();
    }
  }
}

/** A port nothing listens on right now, chosen by the OS */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, () => {
      const address = server.address();
      server.close(() =>
        typeof address === 'object' && address
          ? resolve(address.port)
          : reject(new Error('No port')),
      );
    });
  });
}
