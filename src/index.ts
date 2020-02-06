#!/usr/bin/env node

import chalk from "chalk";
import clear from "clear";
import figlet from "figlet";
import program from "commander";
import kf from "./kafkafunctions";
import {
  CreateTopicsResult
} from "./kafkafunctions";
const fs = require("fs").promises;
import { ITopicMetadata } from "kafkajs";
import pino from "pino";
import protobuf from "protobufjs";
import { printMessage } from "./utils";
import { printMessageJson } from "./utils";
import * as readlineSync from "readline-sync";

const log = pino({
  prettyPrint: {
    colorize: true,
    translateTime: process.env.LOG_TIME_TRANSLATE || true
  },
  level: process.env.LOG_LEVEL || "info"
});

import doodle from "./doodle";

function banner(): void {
  console.log(
    chalk.bold(figlet.textSync("kafkacli", { horizontalLayout: "fitted" }))
  );
}

async function readKafkaConfig(file: string): Promise<any> {
  var json = await fs.readFile(file);
  return JSON.parse(json);
}

async function readProtoDef(file: string): Promise<any> {
  var json = await fs.readFile(file);
  return JSON.parse(json);
}

function printTopics(topics: ITopicMetadata[], full: boolean): void {
  topics.forEach(t => {
    log.info(t.name);
    if (full) {
      t.partitions.forEach(p => {
        let s = JSON.stringify(p);
        log.info(`  ${s}`);
      });
    }
  });
}


banner();

program
  .version("0.0.1")
  .option(
    "-c, --config <config>",
    "configuration file (json). Default: config.json",
    "config.json"
  )
  .option(
    "-p, --protobuf <protoDefintion>",
    "Protobuf definition json created with pbjs from protobufjs (https://www.npmjs.com/package/protobufjs).\nDefault: vmis2proto.json",
    "vmis2proto.json"
  );

program.command("clear").action(() => {
  clear();
  banner();
});

program
  .command("listTopics <regexp>")
  .description("List topics matching regexp")
  .option("-v, --verbose", "detailed output")
  .action(async function(regex, cmdObj) {
    try {
      let kafkaConfig = await readKafkaConfig(cmdObj.parent.config);
      let topics = await kf.listTopics(new RegExp(regex), kafkaConfig);
      printTopics(topics, cmdObj.verbose);
    } catch (e) {
      log.error(e);
    }
    console.log("\n");
    process.exit(0);
  });

  program
  .command("describeTopicsConfig <regexp>")
  .description("Read and print topics config for topics matching regexp")
  .action(async function(regex, cmdObj) {
    try {
      let kafkaConfig = await readKafkaConfig(cmdObj.parent.config);
      let config = await kf.describeTopicsConfig(new RegExp(regex), kafkaConfig);
      config.resources.forEach(r => {
        log.info(r.resourceName);
        r.configEntries.forEach(ce => log.info("  %s=%s", ce.configName, ce.configValue));
      })
    } catch (e) {
      log.error(e);
    }
    console.log("\n");
    process.exit(0);
  });

program
  .command("deleteTopics <regexp>")
  .description("List topics matching regexp")
  .action(async function(regex, cmdObj) {
    try {
      let kafkaConfig = await readKafkaConfig(cmdObj.parent.config);
      let topics = await kf.listTopics(new RegExp(regex), kafkaConfig);
      log.info("ATTENTION: the following topics will be deleted!");
      printTopics(topics, false);
      let answer = readlineSync.keyInYN(
        "Do you really want to delete these topics ?"
      );
      if (answer === true) {
        log.info("Deleting topics !");
        await kf.deleteTopics(new RegExp(regex), kafkaConfig);
        log.info("Topics are marked for deletion !");
      }
    } catch (e) {
      log.error(e);
    }
    console.log("\n");
    process.exit(0);
  });

  program
  .command("createTopic <topic>")
  .description("create a topic")
  .option("-p, --numPartitions <numPartitions>", "number of partitions", 10)
  .option("-r, --replicationFactor <replicationFactor>", "replication factor", 3)
  .option("-c, --configValue <configValue>", "config value. configValue=name=value", gatherConfigs, [])
  .action(async function(topic, cmdObj) {
    try {
      log.info(`creating topic: ${topic} -p=${cmdObj.numPartitions} -r=${cmdObj.replicationFactor} -c=${cmdObj.configValue}`);
      let kafkaConfig = await readKafkaConfig(cmdObj.parent.config);
      let created = await kf.createTopic(topic, kafkaConfig, cmdObj.numPartitions, cmdObj.replicationFactor, cmdObj.configValue);
      if( created ) {
        log.info(`topic: ${topic} -p=${cmdObj.numPartitions} -r=${cmdObj.replicationFactor} -c=${cmdObj.configValue} successfully created!`);
      } else {
        log.info(`topic: ${topic} -p=${cmdObj.numPartitions} -r=${cmdObj.replicationFactor} -c=${cmdObj.configValue} NOT created!`);
      }

    } catch (e) {
      log.error(e);
    }
    console.log("\n");
    process.exit(0);
  });

  program
  .command("createTopics <inputYaml>")
  .description("create topics from an yaml input file")
  .action(async function(inputYaml, cmdObj) {
    try {
      let kafkaConfig = await readKafkaConfig(cmdObj.parent.config);
      let created = await kf.createTopics(inputYaml, kafkaConfig);
      created.forEach(r => {
        if( r.created ) {
          log.info(`topic: ${r.topic} successfully created`);
        } else {
          log.info(`topic: ${r.topic} NOT successfully created. Error: ${r.error}`);
        }
      })
    } catch (e) {
      log.error(e);
    }
    console.log("\n");
    process.exit(0);
  });

  program
  .command("alterTopics <inputYaml>")
  .description("alter topics configuration from an yaml input file")
  .action(async function(inputYaml, cmdObj) {
    try {
      let kafkaConfig = await readKafkaConfig(cmdObj.parent.config);
      let created = await kf.alterTopics(inputYaml, kafkaConfig);
      created.forEach(r => {
        if( r.created ) {
          log.info(`topic: ${r.topic} successfully altered`);
        } else {
          log.info(`topic: ${r.topic} NOT successfully altered. Error: ${r.error}`);
        }
      })
    } catch (e) {
      log.error(e);
    }
    console.log("\n");
    process.exit(0);
  });


  program
  .command("alterTopicsConfig <topics>")
  .description("change configurations of topics given by a regular expression.")
  .option("-c, --configValue <configValue>", "config value. Repeatable parameter. --configValue=name=value", gatherConfigs, [])
  .action(async function(topics, cmdObj) {
    try {
      log.info(`alter topics config: ${topics} -c=${cmdObj.configValue}`);
      let kafkaConfig = await readKafkaConfig(cmdObj.parent.config);
      let created = await kf.alterTopicsConfig(topics, kafkaConfig, cmdObj.configValue);
      created.forEach(r => {
        if( r.created ) {
          log.info(`topic: ${r.topic} successfully changed`);
        } else {
          log.info(`topic: ${r.topic} NOT successfully changed. Error: ${r.error}`);
        }
      })

    } catch (e) {
      log.error(e);
    }
    console.log("\n");
    process.exit(0);
  });

function splitPartitions(value?: string, dummyPrevious?: any): number[] {
  if (value) {
    let partitions: number[] = [];
    value.split(",").forEach(s => partitions.push(parseInt(s)));
    return partitions;
  } else {
    return [];
  }
}

function gatherConfigs(value?: string, previous?: any): string[] {
  return previous.concat([value]);
}

program
  .command("tailTopics <regexp>")
  .description(
    "Tail topics per regexp. Show numOffsets for all partitions or all if omitted"
  )
  .option("-f, --follow", "follow. Stay online an show incoming messages")
  .option("-l, --lines <numLines>", "number of messages per partition", 1)
  .option(
    "-k, --keyFilter <regexp>",
    "regular expression to filter the key with"
  )
  .option("-j, --json", "Create pure json output e.g. to filter it with jq")
  .option(
    "-p, --partitions <partitions>",
    "partitions to tail as comma seperated list. If omitted all partitions are used",
    splitPartitions
  )
  .action(async function(regex, cmdObj) {
    try {
      let kafkaConfig = await readKafkaConfig(cmdObj.parent.config);
      let observable = await kf.tailTopicsObservable(
        new RegExp(regex),
        kafkaConfig,
        cmdObj.lines,
        cmdObj.follow,
        cmdObj.partitions || undefined
      );
      let proto = await readProtoDef(cmdObj.parent.protobuf);
      let root = protobuf.Root.fromJSON(proto);

      observable.subscribe({
        next: m =>
          cmdObj.json
            ? printMessageJson(m.topic, m.partition, m.message, root)
            : printMessage(m.topic, m.partition, m.message, root),
        complete: () => (cmdObj.json ? "" : log.info(`Done!`)),
        error: e => log.error(`An error occurred: ${e}`)
      });
    } catch (e) {
      log.error(e);
    }
  });

program
  .command("publish <yaml>")
  .description(
    "Publish the contents described in a yaml file to a topic. Data is converted to protobuf before publishing."
  )
  .action(async function(yaml, cmdObj) {
    try {
      log.info(`publish: ${yaml}`);
      let kafkaConfig = await readKafkaConfig(cmdObj.parent.config);
      await kf.publish(kafkaConfig, cmdObj.parent.protobuf, yaml);
      log.info(`published: ${yaml}`);
    } catch (e) {
      log.error(e);
    }
    console.log("\n");
    process.exit(0);
  });

program
  .command("getTopicOffsets <topic>")
  .description("Gets the partition offsets of a certain topic")
  .action(async function(topic, cmdObj) {
    try {
      let kafkaConfig = await readKafkaConfig(cmdObj.parent.config);
      let topicOffsets = await kf.getTopicOffsets(topic, kafkaConfig);
      topicOffsets.forEach(o => {
        log.info(JSON.stringify(o));
      });
    } catch (e) {
      log.error(e);
    }
    console.log("\n");
    process.exit(0);
  });

program
  .command("testProducer <topic>")
  .description("Produces dummy text messages to one topic !")
  .option("-n <numMessages>", "number of message", 10)
  .option("-d <delay>", "delay im ms", 0)
  .action(async function(topic, cmdObj) {
    try {
      let kafkaConfig = await readKafkaConfig(cmdObj.parent.config);
      await kf.testProduce("JayBeeTest", kafkaConfig, cmdObj.D, cmdObj.N);
    } catch (e) {
      log.error(e);
    }
    console.log("\n");
    process.exit(0);
  });

// error on unknown commands
program.on("command:*", function() {
  console.error(
    "Invalid command: %s\nSee --help for a list of available commands.",
    program.args.join(" ")
  );
  program.help();
  process.exit(1);
});

program.parse(process.argv);
