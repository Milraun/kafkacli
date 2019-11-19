import {
  Kafka,
  logLevel,
  ITopicMetadata,
  KafkaMessage,
  IHeaders,
  EachMessagePayload
} from "kafkajs";
import Timeout from "await-timeout";
import protobuf from "protobufjs";
import YAML from "yaml";
import pino from "pino";
import { Observable, Subject } from 'rxjs';

import {
  printMessage,
  replaceProtoTimeStampsInObject
} from './utils'

const log = pino({
  prettyPrint: {
    colorize: true,
    translateTime: process.env.LOG_TIME_TRANSLATE || true
  },
  level: process.env.LOG_LEVEL || "info"
});

const fs = require("fs").promises;

async function readProtoDef (file: string): Promise<any> {
  var json = await fs.readFile(file);
  return JSON.parse(json);
}

export async function listTopicsServer (
  topic: RegExp,
  kafka: Kafka
): Promise<ITopicMetadata[]> {
  const adminClient = kafka.admin();
  await adminClient.connect();
  let metaData = await adminClient.fetchTopicMetadata({ topics: [] });

  let filteredTopics: ITopicMetadata[] = [];

  for (let t of metaData.topics) {
    if (t.name.match(topic)) {
      filteredTopics.push(t);
    }
  }

  await adminClient.disconnect();
  return filteredTopics;
}

export async function listTopics (
  topic: RegExp,
  kafkaCliConfig: any
): Promise<ITopicMetadata[]> {
  const kafka = new Kafka(kafkaCliConfig);
  return listTopicsServer(topic, kafka);
}

export async function deleteTopicsServer (
  topic: RegExp,
  kafka: Kafka
): Promise<void> {
  const adminClient = kafka.admin();
  await adminClient.connect();
  let metaData = await adminClient.fetchTopicMetadata({ topics: [] });

  let filteredTopics: ITopicMetadata[] = [];

  for (let t of metaData.topics) {
    if (t.name.match(topic)) {
      filteredTopics.push(t);
    }
  }

  filteredTopics.forEach(t => log.info(`Deleting Topic $t`));
  let topicsToDelete = filteredTopics.map(t => t.name);
  await adminClient.deleteTopics({ topics: topicsToDelete });
  await adminClient.disconnect();
}

export async function deleteTopics (
  topics: RegExp,
  kafkaCliConfig: any
) {
  const kafka = new Kafka(kafkaCliConfig);
  await deleteTopicsServer(topics, kafka);
}
export async function testProduce (
  topic: string,
  kafkaCliConfig: any,
  delay: number,
  numOfMessage: number
): Promise<void> {
  const kafka = new Kafka(kafkaCliConfig);
  const producer = kafka.producer();
  await producer.connect();
  try {
    for (let i = 0; i < numOfMessage; ++i) {
      let key = "k_" + (i % 10);
      let value = `{
                    'id': ${i},
                    'txt': 'a text of numbers'
                }`;
      await producer.send({
        topic: topic,
        messages: [
          {
            key: `${key}`,
            value: value
          }
        ]
      });
      log.info(`Published to key: ${key} value: ${value}`);
      await Timeout.set(delay);
    }
  } finally {
    await producer.disconnect();
  }
}

export interface TopicOffsets {
  readonly partition: number;
  readonly offset: string;
  readonly high: string;
  readonly low: string;
}

export async function getTopicOffsets (
  topic: string,
  kafkaCliConfig: any
): Promise<Array<TopicOffsets>> {
  const kafka = new Kafka(kafkaCliConfig);
  const adminClient = kafka.admin();
  await adminClient.connect();
  try {
    return await adminClient.fetchTopicOffsets(topic);
  } finally {
    await adminClient.disconnect();
  }
}

export async function tailTopics (
  topics: RegExp,
  kafkaCliConfig: any,
  protoDefinitionFile: string,
  numMessages?: number,
  follow?: boolean,
  keyFilter?: RegExp
): Promise<any> {
  const kafka = new Kafka(kafkaCliConfig);
  const consumer = kafka.consumer({ groupId: kafkaCliConfig.groupId });
  await consumer.connect();
  try {
    let topicsMeta = await listTopics(topics, kafkaCliConfig);

    log.info(
      `Tailing topics with ${numMessages} message(s) per partition and follow = ${follow} ` +
      (keyFilter ? `keyFilter = ${keyFilter}` : "")
    );
    topicsMeta.forEach(tm => log.info(`  Topic: ${tm.name}`));

    let partitionOffsetsPerTopic: { [id: string]: TopicOffsets[] } = {};
    let endOffsetPerTopicPartition: { [topicPartition: string]: number } = {};
    let finishedTopicPartitions: { [topicPartition: string]: number } = {};

    let proto = await readProtoDef(protoDefinitionFile);
    let root = protobuf.Root.fromJSON(proto);

    topicsMeta.forEach(async tm => {
      let partitionOffsets = await getTopicOffsets(tm.name, kafkaCliConfig);
      partitionOffsetsPerTopic[tm.name] = partitionOffsets;
      partitionOffsets.forEach(
        to =>
          (endOffsetPerTopicPartition[tm.name + "/" + to.partition] =
            +to.high || 0)
      );
    });
    await consumer.subscribe({ topic: topics });
    await consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        if (
          !keyFilter ||
          !message.key ||
          message.key.toString().match(keyFilter)
        ) {
          printMessage(topic, partition, message, root);
        }
        if (!follow) {
          let topicPartition = topic + "/" + partition;
          if (
            !finishedTopicPartitions[topicPartition] &&
            endOffsetPerTopicPartition[topicPartition]
          ) {
            let high = endOffsetPerTopicPartition[topicPartition];
            if (+message.offset === high - 1) {
              finishedTopicPartitions[topicPartition] = high;
            }
          }

          if (
            Object.keys(finishedTopicPartitions).length ===
            Object.keys(endOffsetPerTopicPartition).length
          ) {
            consumer.disconnect();
            consumer.stop();
          }
        }
      }
    });

    Object.entries(partitionOffsetsPerTopic).forEach(([topic, partitions]) => {
      partitions.forEach(to => {
        let high: number = 0;
        let low: number = 0;
        if (to.high) {
          high = +to.high;
        }
        if (to.low) {
          low = +to.low;
        }

        if (low === high) {
          //empty topic --> already finished
          let topicPartition = topic + "/" + to.partition;
          finishedTopicPartitions[topicPartition] = high;
        } else {
          let offset: number = low;

          let nm = numMessages && numMessages > 0 ? numMessages : 1;
          if (high - nm >= low) {
            offset = high - nm;
          }
          consumer.seek({
            topic: topic,
            partition: to.partition,
            offset: offset.toString()
          });
        }
      });
    });
  } finally {
    //    consumer.disconnect();
  }
}

export async function tailTopicsObservable (
  topics: RegExp,
  kafkaCliConfig: any,
  numMessages?: number,
  follow?: boolean
): Promise<Observable<EachMessagePayload>> {
  const kafka = new Kafka(kafkaCliConfig);
  const consumer = kafka.consumer({ groupId: kafkaCliConfig.groupId });
  await consumer.connect();
  try {
    let topicsMeta = await listTopics(topics, kafkaCliConfig);

    log.info(
      `Tailing topics with ${numMessages} message(s) per partition and follow = ${follow} `
    );
    topicsMeta.forEach(tm => log.info(`  Topic: ${tm.name}`));

    let partitionOffsetsPerTopic: { [id: string]: TopicOffsets[] } = {};
    let endOffsetPerTopicPartition: { [topicPartition: string]: number } = {};
    let finishedTopicPartitions: { [topicPartition: string]: number } = {};

    topicsMeta.forEach(async tm => {
      let partitionOffsets = await getTopicOffsets(tm.name, kafkaCliConfig);
      partitionOffsetsPerTopic[tm.name] = partitionOffsets;
      partitionOffsets.forEach(
        to =>
          (endOffsetPerTopicPartition[tm.name + "/" + to.partition] =
            +to.high || 0)
      );
    });
    await consumer.subscribe({ topic: topics });

    const subject = new Subject<EachMessagePayload>();
    const observable = subject.asObservable();

    await consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        let topicPartition = topic + "/" + partition;
        if (!finishedTopicPartitions[topicPartition]) {
          subject.next({ topic, partition, message });
        }
        if (!follow) {
          if (
            !finishedTopicPartitions[topicPartition] &&
            endOffsetPerTopicPartition[topicPartition]
          ) {
            let high = endOffsetPerTopicPartition[topicPartition];
            if (+message.offset === high - 1) {
              finishedTopicPartitions[topicPartition] = high;
            }
          }

          if (
            Object.keys(finishedTopicPartitions).length ===
            Object.keys(endOffsetPerTopicPartition).length
          ) {
            consumer.disconnect();
            consumer.stop();
            subject.complete();
          }
        }
      }
    });

    Object.entries(partitionOffsetsPerTopic).forEach(([topic, partitions]) => {
      partitions.forEach(to => {
        let high: number = 0;
        let low: number = 0;
        if (to.high) {
          high = +to.high;
        }
        if (to.low) {
          low = +to.low;
        }

        if (low === high) {
          //empty topic --> already finished
          let topicPartition = topic + "/" + to.partition;
          finishedTopicPartitions[topicPartition] = high;
        } else {
          let offset: number = low;

          let nm = numMessages && numMessages > 0 ? numMessages : 1;
          if (high - nm >= low) {
            offset = high - nm;
          }
          consumer.seek({
            topic: topic,
            partition: to.partition,
            offset: offset.toString()
          });
        }
      });
    });
    return observable;
  } catch (e) {
    log.error(e);
    throw e;
  } finally {
    //    consumer.disconnect();
  }
}

export interface PublishDescription {
  protobufType: string;
  topic: string;
  objects: [
    {
      key: string;
      headers: { [k: string]: string };
      data: [any];
    }
  ];
}

export async function publish (
  kafkaCliConfig: any,
  protoDefinitionFile: string,
  yamlFile: string
): Promise<void> {
  try {
    const kafka = new Kafka(kafkaCliConfig);
    let proto = await readProtoDef(protoDefinitionFile);
    let root = protobuf.Root.fromJSON(proto);
    let yaml = ((await fs.readFile(yamlFile)) as Buffer).toString();
    let y = YAML.parse(yaml) as PublishDescription;
    y = replaceProtoTimeStampsInObject(y, root);
    let type = root.lookupType(y.protobufType);
    let topic = y.topic;
    if (type) {
      let producer = kafka.producer();
      try {
        await producer.connect();
        y.objects.forEach(async o => {
          let pb = type.encode(o.data).finish();
          if (pb) {
            let key = o.key;
            let headers: IHeaders = {};
            Object.entries(headers).forEach(([k, v]) => (headers[k] = v));

            log.info(`Sending topic: ${topic} key: ${key} headers: ${headers}`);
            await producer.send({
              topic: topic,
              messages: [
                {
                  key: key,
                  value: Buffer.from(pb),
                  headers: headers
                }
              ]
            });
            log.info(`Done sending topic: ${topic} key: ${key}`);
          } else {
            log.error(`Could not encode Type: ${type}\n==Data==:\n${o}`);
          }
        });
      } catch (e) {
        log.error(e);
      } finally {
        await producer.disconnect();
        return;
      }
    } else {
      log.error(`Could not encode Type: ${type}`);
    }
  } catch (e) {
    log.error(e);
  }
}

export default {
  listTopics,
  listTopicsServer,
  deleteTopics,
  deleteTopicsServer,
  getTopicOffsets,
  testProduce,
  tailTopics,
  tailTopicsObservable,
  publish
};

