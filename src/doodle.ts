import protobuf from "protobufjs";
import YAML from "yaml";
import Long from "long";

const fs = require("fs").promises;
const TS_LITERAL = "#TS(";

// import {TopicConfig, TopicsConfig, CreateTopicsConfig} from "./kafkafunctions"
// import YAML from "yaml";


// const ctc: CreateTopicsConfig = {
//   topicsConfigs: [
//     {
//       topics: ["hugo1", "hugo2"],
//       config: {
//         numPartitions: 2,
//         replicationFactor: 3
//       }
//     },
//     {
//       topics: ["fritz1", "fritz2"],
//       config: {
//         numPartitions: 3,
//         replicationFactor: 3
//       }
//     }
//   ]
// }

// const s = YAML.stringify(ctc);

// fs.writeFile("test.yaml", s);


async function readProtoDef(file: string): Promise<any> {
  var json = await fs.readFile(file);
  return JSON.parse(json);
}

export async function readYaml(): Promise<void> {
  let protobufDef = await readProtoDef("vmis2proto.json");
  let yaml = (await fs.readFile("external-situations.yaml")) as Buffer;
  let y = YAML.parse(yaml.toString());
  let root = protobuf.Root.fromJSON(protobufDef);
  y = replaceTimeStampsInObject(y, root);
  let type = root.lookupType(y.protobufType);
  if (type) {
    let pb = type.encode(y.objects[0].data).finish();
    if (pb) {
      let m = type.toObject(type.decode(pb));
      if (m) {
        console.log(YAML.stringify(replaceTimeStampInObject(m)));
      }
    }
  }
}

function getTS(val: any,  root: protobuf.Root): any | undefined {
  if (typeof val !== "string") {
    return undefined;
  } else {
    if (val.slice(0, TS_LITERAL.length) === TS_LITERAL) {
      let d = val.slice(TS_LITERAL.length, val.length - 1);
      let date = new Date(d)
      let t = date.getTime() / 1000;
      let tsType = root.lookupType("google.protobuf.Timestamp");
      let lDate = tsType.create({seconds: Math.trunc(t), nanos: 0 })
      return lDate;
    }
  }
}

function replaceTimeStampsInObject(val: any, root: protobuf.Root): any {
  let lDate = getTS(val, root);
  if (lDate) {
    return lDate;
  } else {
    Object.keys(val).forEach(k => replaceTimeStamps(val, k, val[k], root));
    return val;
  }
}

function replaceTimeStamps(obj: any, key: string, val: any, root: protobuf.Root): void {
  let lDate = getTS(val, root);
  if (lDate) {
    obj[key] = lDate;
  } else if (Array.isArray(val)) {
    val.forEach(o => {
      Object.keys(o).forEach(k => replaceTimeStamps(o, k, o[k], root));
    });
  } else if (isObject(val)) {
    Object.keys(val).forEach(k => replaceTimeStamps(val, k, val[k], root));
  } else {
    //do nothing here
  }
}

function replaceTimeStamp(obj: any, key: string, val: any): void {
    if( isTimestamp(val) ) {
      let l = val.seconds as Long;
      let n = l.toNumber() * 1000;
      obj[key] = new  Date(n).toLocaleString();
    } else if(Array.isArray(val)) {
      val.forEach(o => {
        Object.keys(o).forEach(k => replaceTimeStamp(o, k, o[k]))
      });
    }  else if ( isObject(val) ) {
      Object.keys(val).forEach(k => replaceTimeStamp(val, k, val[k]))
    } else {
      //do nothing here
    }
  }
  
  function replaceTimeStampInObject(val: any): any {
    if( isTimestamp(val) ) {
      let l = val.seconds as Long;
      let n = l.toNumber() * 1000;
      return new Date(n).toLocaleString();
    } else {
      Object.keys(val).forEach(k => replaceTimeStamp(val, k, val[k]))
    } 
    return val;
  }

function isObject(val?: any): boolean {
  if (val === null) {
    return false;
  }
  return typeof val === "object";
}

function isTimestamp(val?: any): boolean {
  if (val === null) {
    return false;
  }
  return val["seconds"] && val["seconds"] instanceof Long; //simple check. Probably we must check for the name of the key.
}

export default {
  readYaml
};
