import {
  Kafka,
  logLevel,
  ITopicMetadata,
  KafkaMessage,
  IHeaders,
  EachMessagePayload,
  DescribeConfigResponse,
  ResourceConfigQuery,
  ResourceTypes
} from "kafkajs";
import Timeout from "await-timeout";
import protobuf from "protobufjs";
import YAML from "yaml";
import pino from "pino";
import { Observable, ReplaySubject } from 'rxjs';

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
  return await listTopicsServer(topic, kafka);
}

export async function describeTopicsConfigServer (
  topic: RegExp,
  kafka: Kafka
): Promise<DescribeConfigResponse> {
  const adminClient = kafka.admin();
  await adminClient.connect();
  const metaData = await adminClient.fetchTopicMetadata({ topics: [] });
  const filteredTopics = metaData.topics.filter(t => t.name.match(topic))
 
  const query = filteredTopics.map(t => {
    let rq = {
      type: ResourceTypes.TOPIC,
      name: t.name
    };
    return rq;
  });

  const configs = await adminClient.describeConfigs({
      resources: query,
      includeSynonyms: false
    });
    

  await adminClient.disconnect();
  return configs;
}

export async function describeTopicsConfig (
  topic: RegExp,
  kafkaCliConfig: any
): Promise<DescribeConfigResponse> {
  const kafka = new Kafka(kafkaCliConfig);
  return await describeTopicsConfigServer(topic, kafka);
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

  filteredTopics.forEach(t => log.info(`Deleting Topic ${t.name}`));
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
  return await getTopicOffsetsServer(topic, kafka);
}

export async function getTopicOffsetsServer (
  topic: string,
  kafka: Kafka
): Promise<Array<TopicOffsets>> {

  const adminClient = kafka.admin();
  await adminClient.connect();
  try {
    return await adminClient.fetchTopicOffsets(topic);
  } finally {
    await adminClient.disconnect();
  }
}

/**
 * Tailing topics selected by a regular expression 
 * returning a rxjs Observable.
 * @param topics the topics regex
 * @param kafkaCliConfig the config object needed to initialize kafka
 * @param numMessages number of messages to go back from tail for each partition
 * @param follow keep listening and show new message as they appear
 * @param partitions list of partitions to use. If undefined all partitiions are used.
 */
export async function tailTopicsObservable (
  topics: RegExp,
  kafkaCliConfig: any,
  numMessages?: number,
  follow?: boolean,
  partitions?: number[]
): Promise<Observable<EachMessagePayload>> {
  const kafka = new Kafka(kafkaCliConfig);
  return await tailTopicsObservableServer(topics, kafka, kafkaCliConfig.groupId, numMessages, follow, partitions);
}

/**
 * Tailing topics selected by a regular expression 
 * returning a rxjs Observable.
 * @param topics the topics regex
 * @param kafka an initialized kafka object
 * @param numMessages number of messages to go back from tail for each partition
 * @param follow keep listening and show new message as they appear
 * @param partitions list of partitions to use. If undefined all partitiions are used.
 */
export async function tailTopicsObservableServer (
  topics: RegExp,
  kafka: Kafka,
  groupId: string,
  numMessages?: number,
  follow?: boolean,
  partitions?: number[]
): Promise<Observable<EachMessagePayload>> {
  const consumer = kafka.consumer({ groupId: groupId });
  await consumer.connect();
  try {
    let topicsMeta = await listTopicsServer(topics, kafka);

    let partitionOffsetsPerTopic: { [id: string]: TopicOffsets[] } = {};
    let endOffsetPerTopicPartition: { [topicPartition: string]: number } = {};
    let finishedTopicPartitions: { [topicPartition: string]: number } = {};

    topicsMeta.forEach(async tm => {
      let partitionOffsets = await getTopicOffsetsServer(tm.name, kafka);
      partitionOffsetsPerTopic[tm.name] = partitionOffsets.filter(to => !partitions || partitions.includes(to.partition));
      partitionOffsets
        .filter(to => !partitions || partitions.includes(to.partition))
        .forEach(
          to => {
            (endOffsetPerTopicPartition[tm.name + "/" + to.partition] =
              +to.high || 0)
          }
        );
    });

    log.info(
      `Tailing topics with ${numMessages} message(s) per partition and follow = ${follow} `
    );
    topicsMeta.forEach(tm => log.info(`  Topic: ${tm.name}`));
    if (partitions) {
      let sPart = partitions.join(",");
      log.info(`Using partitions: ${sPart}`);
    }
    await consumer.subscribe({ topic: topics });

    const subject = new ReplaySubject<EachMessagePayload>(100, 10000);
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

export interface PartitionDescription {
  readonly partition: number;
  readonly from: number; //-1 = beginning
  readonly to: number; //-1 = end
}

export interface TopicDescription {
  readonly topic: string; //The topic name
  readonly partitions?: PartitionDescription[]; //Partitions and offset to read. If empty read the whole topic
}


//TODO: new method readTopics to read the complete or parts of the topic, for all or selected partitions with filters on key and message (and headers)
/**
 * Read topics selected by a regular expression 
 * returning a rxjs Observable.
 * @param topics the topics regex
 * @param kafkaCliConfig the config object needed to initialize kafka
 * @param numMessages number of messages to go back from tail for each partition
 * @param follow keep listening and show new message as they appear
 * @param partitions list of partitions to use. If undefined all partitiions are used.
 */
/*
export async function readTopicsObservable (
  topics: TopicDescription[],
  kafkaCliConfig: any,
  keyFilter?: RegExp,
  messageFilter?: RegExp
): Promise<Observable<EachMessagePayload>> {

  if( !topics ) {
    log.info("No topic descriptions submitted! Do nothing.");
  }

  const kafka = new Kafka(kafkaCliConfig);
  const consumer = kafka.consumer({ groupId: kafkaCliConfig.groupId });
  await consumer.connect();
  try {
    let partitionOffsetsPerTopic: { [id: string]: TopicOffsets[] } = {};
    let endOffsetPerTopicPartition: { [topicPartition: string]: number } = {};
    let finishedTopicPartitions: { [topicPartition: string]: number } = {};

    topics.forEach(async tm => {
      let partitionOffsets = await getTopicOffsets(tm.topic, kafkaCliConfig);
      partitionOffsetsPerTopic[tm.topic] = partitionOffsets.filter(to => !tm.partitions || tm.partitions.find(pd => to.partition === pd.partition));
      partitionOffsets
        .filter(to => !tm.partitions || tm.partitions.find(pd => to.partition === pd.partition))
        .forEach(
        to => {
          (endOffsetPerTopicPartition[tm.topic + "/" + to.partition] =
            +to.high || 0)
        }
      );
    });

    let kfText = keyFilter?"with keyFilter: " + keyFilter:"without keyfilter";
    let mfText = messageFilter?"with messageFilter: " + messageFilter:"without messagfilter";
    log.info(
      `Reading topics ${kfText} and ${mfText}`
    );
    topics.forEach(tm => log.info(`  Topic: ${tm.topic}`));
    //TODO: Print partition info

//DRAN: ab hier gehts weiter    
    if( partitions ) {
      let sPart = partitions.join(",");
      log.info(`Using partitions: ${sPart}`);
    }
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
*/
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
  describeTopicsConfig,
  describeTopicsConfigServer,
  deleteTopics,
  deleteTopicsServer,
  getTopicOffsets,
  getTopicOffsetsServer,
  testProduce,
  tailTopicsObservable,
  tailTopicsObservableServer,
  publish
};

