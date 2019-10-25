import {
  Kafka,
  logLevel,
  ITopicMetadata,
  KafkaMessage,
  IHeaders
} from "kafkajs";
import Timeout from "await-timeout";
import protobuf from "protobufjs";
import Long from "long";
import YAML from "yaml";
import pino from "pino";

const log = pino({
  prettyPrint: {
    colorize: true,
    translateTime: process.env.LOG_TIME_TRANSLATE || true
  },
  level: process.env.LOG_LEVEL || "info"
});

const fs = require("fs").promises;
const TS_LITERAL = "#TS(";
const X_PROTO_HEADER = "X-Protobuf-Type";

async function readProtoDef(file: string): Promise<any> {
  var json = await fs.readFile(file);
  return JSON.parse(json);
}

export async function listTopics(
  topic: RegExp,
  kafkaCliConfig: any
): Promise<ITopicMetadata[]> {
  const kafka = new Kafka(kafkaCliConfig);
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

export async function testProduce(
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

export async function getTopicOffsets(
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

export async function tailTopics(
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

          let nm = numMessages && numMessages>0?numMessages:1;
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

export async function publish(
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
            headers[X_PROTO_HEADER] = Buffer.from(y.protobufType);

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
  getTopicOffsets,
  testProduce,
  tailTopics,
  publish
};

/**
 * Replace all timestamps with string representations in a object decoded from protobuf.
 * @param val the document decoded from protobuf.
 */
function replaceTimeStampInObject(val: any): any {
  if (isTimestamp(val)) {
    let l = val.seconds as Long;
    let n = l.toNumber() * 1000;
    return new Date(n).toLocaleString();
  } else {
    Object.keys(val).forEach(k => replaceTimeStamp(val, k, val[k]));
  }
  return val;
}

/**
 * Recursive helper function to replace timestamps (protobuf) with string representations
 * @param obj the containing object
 * @param key the key of the current object to check
 * @param val the current object
 */
function replaceTimeStamp(obj: any, key: string, val: any): void {
  if (isTimestamp(val)) {
    let l = val.seconds as Long;
    let n = l.toNumber() * 1000;
    obj[key] = new Date(n).toLocaleString();
  } else if (Array.isArray(val)) {
    val.forEach(o => {
      Object.keys(o).forEach(k => replaceTimeStamp(o, k, o[k]));
    });
  } else if (isObject(val)) {
    Object.keys(val).forEach(k => replaceTimeStamp(val, k, val[k]));
  } else {
    //do nothing here
  }
}

/**
 * check if val is an object
 * @param val the object to check
 * @returns true if val is an object
 */
function isObject(val?: any): boolean {
  if (val === null) {
    return false;
  }
  return typeof val === "object";
}

/**
 * check if val is a timestamp
 * @param val the object to check
 * @returns true if val is a timestamp
 */
function isTimestamp(val?: any): boolean {
  if (val === null) {
    return false;
  }
  return val["seconds"] && val["seconds"] instanceof Long; //simple check. Probably we must check for the name of the key.
}

/**
 * checks if an object is a timestamp and returns if it is so.
 * A timestamp is a string starting with the `${TS_LITERAL}` and ending with ')'
 * @param val the object to check
 * @param root the protobuf.Root tu create the Timestamp
 */
function getTS(val: any, root: protobuf.Root): any | undefined {
  if (typeof val !== "string") {
    return undefined;
  } else {
    if (val.slice(0, TS_LITERAL.length) === TS_LITERAL) {
      let d = val.slice(TS_LITERAL.length, val.length - 1);
      let date = new Date(d);
      let t = date.getTime() / 1000;
      let tsType = root.lookupType("google.protobuf.Timestamp");
      let lDate = tsType.create({ seconds: Math.trunc(t), nanos: 0 });
      return lDate;
    }
  }
}

/**
 * Replace all 'String' timestamps in an object by protobuf timestamps
 * @param val the object to change
 * @param root the protobuf.Root tu create the Timestamp
 */
function replaceProtoTimeStampsInObject(val: any, root: protobuf.Root): any {
  let lDate = getTS(val, root);
  if (lDate) {
    return lDate;
  } else {
    Object.keys(val).forEach(k =>
      replaceWithProtoTimeStamps(val, k, val[k], root)
    );
    return val;
  }
}

/**
 * Helper function to replace 'String' timestampswith protobuf timestamps
 * @param obj the containing object
 * @param key the key of the current object to check
 * @param val the current object
 * @param root the protobuf.Root tu create the Timestamp
 */
function replaceWithProtoTimeStamps(
  obj: any,
  key: string,
  val: any,
  root: protobuf.Root
): void {
  let lDate = getTS(val, root);
  if (lDate) {
    obj[key] = lDate;
  } else if (Array.isArray(val)) {
    val.forEach(o => {
      Object.keys(o).forEach(k => replaceWithProtoTimeStamps(o, k, o[k], root));
    });
  } else if (isObject(val)) {
    Object.keys(val).forEach(k =>
      replaceWithProtoTimeStamps(val, k, val[k], root)
    );
  } else {
    //do nothing here
  }
}

/**
 * prints a message received via kafka. Checks if the message is known protobuf type and decodes it if necessary
 * @param topic the received topic
 * @param partition  the partition
 * @param message  the message containing the key, the message value and headers
 * @param root  the protobuf.Root object to decode a protobuf message
 */
function printMessage(
  topic: string,
  partition: number,
  message: KafkaMessage,
  root: protobuf.Root
): void {
  let date = new Date(+message.timestamp);
  let header =
    (message.headers &&
      message.headers[X_PROTO_HEADER] &&
      message.headers[X_PROTO_HEADER].toString()) ||
    null;
  let decodedMessage = message.value.toString();
  if (header) {
    let protoMessage = root.lookupType(header);
    if (protoMessage) {
      let decodedProtoMessage = protoMessage.toObject(
        protoMessage.decode(message.value)
      );

      decodedProtoMessage = replaceTimeStampInObject(decodedProtoMessage);

      decodedMessage = JSON.stringify(decodedProtoMessage, null, 2);
    }
  }
  log.info(
    `Topic: ${topic}, Time: ${date.toLocaleString()}  Key: ${
      message.key
    }, Partition: ${partition}, Offset: ${message.offset}`
  );

  if (message.headers) {
    let headers = message.headers as IHeaders;
    Object.entries(headers).forEach(([k, e]) => {
      let v = e.toString();
      log.info(`  ${k} => ${v}`);
    });
  }

  log.info(decodedMessage);
}
