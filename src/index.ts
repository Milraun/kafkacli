#!/usr/bin/env node

import chalk from "chalk";
import clear from "clear";
import figlet from "figlet";
import program from "commander";
import kf from "./kafkafunctions";
const fs = require("fs").promises;
import { ITopicMetadata } from "kafkajs";
import pino from "pino";
import protobuf from "protobufjs";
import { printMessage } from "./utils"
import * as readlineSync  from "readline-sync";

const log = pino({
  prettyPrint: {
    colorize: true,
    translateTime: process.env.LOG_TIME_TRANSLATE || true
  },
  level: process.env.LOG_LEVEL || "info"
});

import doodle from "./doodle";

function banner (): void {
  console.log(
    chalk.bold(figlet.textSync("kafkacli", { horizontalLayout: "fitted" }))
  );
}

async function readKafkaConfig (file: string): Promise<any> {
  var json = await fs.readFile(file);
  return JSON.parse(json);
}

async function readProtoDef (file: string): Promise<any> {
  var json = await fs.readFile(file);
  return JSON.parse(json);
}

function printTopics (topics: ITopicMetadata[], full: boolean): void {
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
  .action(async function (regex, cmdObj) {
    let kafkaConfig = await readKafkaConfig(cmdObj.parent.config);
    let topics = await kf.listTopics(new RegExp(regex), kafkaConfig);
    printTopics(topics, cmdObj.verbose);
  });

program
  .command("deleteTopics <regexp>")
  .description("List topics matching regexp")
  .action(async function (regex, cmdObj) {
    let kafkaConfig = await readKafkaConfig(cmdObj.parent.config);
    let topics = await kf.listTopics(new RegExp(regex), kafkaConfig);
    log.info("ATTENTION: the following topics will be deleted!")
    printTopics(topics, false);
    let answer = readlineSync.keyInYN("Do you really want to delete these topics ?");
    if(answer === true) {
      log.info("Deleting topics !");
      await kf.deleteTopics(new RegExp(regex), kafkaConfig);
      log.info("Topics are marked for deletion !");
    }
  });

// program
//   .command("tailTopics <regexp>")
//   .description(
//     "Tail topics per regexp. Show numOffsets for all partitions or all if omitted"
//   )
//   .option("-f, --follow", "follow. Stay online an show incoming messages")
//   .option("-l, --lines <numLines>", "number of messages per partition", 1)
//   .option(
//     "-k, --keyFilter <regexp>",
//     "regular expression to filter the key with"
//   )
//   .action(async function (regex, cmdObj) {
//     let kafkaConfig = await readKafkaConfig(cmdObj.parent.config);
//     await kf.tailTopics(
//       new RegExp(regex),
//       kafkaConfig,
//       cmdObj.parent.protobuf,
//       cmdObj.lines,
//       cmdObj.follow,
//       cmdObj.keyFilter
//     );
//   });

function splitPartitions(value?: string, dummyPrevious?: any): number[] {
  if(value) {
    let partitions: number[] = [];
    value.split(",").forEach(s => partitions.push(parseInt(s)));
    return partitions;
  }
  else {
    return [];
  }
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
  .option("-p, --partitions <partitions>", "partitions to tail as comma seperated list. If omitted all partitions are used", splitPartitions )
  .action(async function (regex, cmdObj) {
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
      next: (m) => printMessage(m.topic, m.partition, m.message, root),
      complete: () => log.info(`Done!`),
      error: (e) => log.error(`An error occured: ${e}`)
    })

  });

program
  .command("publish <yaml>")
  .description(
    "Publish the contents described in a yaml file to a topic. Data is converted to protobuf before publishing."
  )
  .action(async function (yaml, cmdObj) {
    log.info(`publish: ${yaml}`);
    let kafkaConfig = await readKafkaConfig(cmdObj.parent.config);
    await kf.publish(kafkaConfig, cmdObj.parent.protobuf, yaml);
    log.info(`published: ${yaml}`);
    process.exit(0);
  });

program
  .command("getTopicOffsets <topic>")
  .description("Gets the partition offsets of a certain topic")
  .action(async function (topic, cmdObj) {
    let kafkaConfig = await readKafkaConfig(cmdObj.parent.config);
    let topicOffsets = await kf.getTopicOffsets(topic, kafkaConfig);
    topicOffsets.forEach(o => {
      log.info(JSON.stringify(o));
    });
  });

program
  .command("testProducer <topic>")
  .description("Produces dummy text messages to one topic !")
  .option("-n <numMessages>", "number of message", 10)
  .option("-d <delay>", "delay im ms", 0)
  .action(async function (topic, cmdObj) {
    let kafkaConfig = await readKafkaConfig(cmdObj.parent.config);
    await kf.testProduce("JayBeeTest", kafkaConfig, cmdObj.D, cmdObj.N);
  });

// error on unknown commands
program.on("command:*", function () {
  console.error(
    "Invalid command: %s\nSee --help for a list of available commands.",
    program.args.join(" ")
  );
  program.help();
  process.exit(1);
});

program.parse(process.argv);
