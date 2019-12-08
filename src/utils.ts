import Long from "long";
import pino from "pino";
import {
  KafkaMessage,
  IHeaders
} from "kafkajs";
import { getTopicOffsets } from "./kafkafunctions";

const TS_LITERAL = "#TS(";
const X_PROTO_HEADER = "X-Protobuf-Type";

const log = pino({
  prettyPrint: {
    colorize: true,
    translateTime: process.env.LOG_TIME_TRANSLATE || true
  },
  level: process.env.LOG_LEVEL || "info"
});



/**
 * Replace all timestamps with string representations in a object decoded from protobuf.
 * @param val the document decoded from protobuf.
 */
export function replaceTimeStampInObject (val: any): any {
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
function replaceTimeStamp (obj: any, key: string, val: any): void {
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
function isObject (val?: any): boolean {
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
function isTimestamp (val?: any): boolean {
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
function getTS (val: any, root: protobuf.Root): any | undefined {
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
export function replaceProtoTimeStampsInObject (val: any, root: protobuf.Root): any {
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
function replaceWithProtoTimeStamps (
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
export function printMessage (
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

  log.info("\n" + decodedMessage);
}

/**
 * prints a message received via kafka. Checks if the message is known protobuf type and decodes it if necessary
 * Creates one Json-Object with topic, partition, headers and message as members so that the output can be
 * filtered by e.g. jq
 * @param topic the received topic
 * @param partition  the partition
 * @param message  the message containing the key, the message value and headers
 * @param root  the protobuf.Root object to decode a protobuf message
 */
export function printMessageJson (
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

      decodedMessage = replaceTimeStampInObject(decodedProtoMessage);

    }
  }

  let outHeaders: { [key: string]: string } = {};
  if (message.headers) {
    let headers = message.headers as IHeaders;
    Object.entries(headers).forEach(([k, e]) => {
      let v = e.toString();
      outHeaders[k] = v;
    });
  }

  let out = {
    topic: topic,
    time: date.toLocaleDateString,
    key: message.key.toString(),
    partition: partition,
    offset: message.offset,
    headers: outHeaders,
    message: decodedMessage,
  };

  console.log(JSON.stringify(out, null, 2));
}

export default {
  printMessage,
  printMessageJson,
  replaceTimeStampInObject,
  replaceProtoTimeStampsInObject
}

