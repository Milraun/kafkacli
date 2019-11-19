import App from "./app";
import TopicController from "./topic.controller";
import 'dotenv/config';
import {
  cleanEnv,
  str,
  json,
  port
} from "envalid";
import { Kafka } from "kafkajs";

function validateEnv () {
  cleanEnv(process.env, {
    KAFKA_CLUSTER_NAME: str(),
    KAFKA_CLIENT_ID: str(),
    KAFKA_BROKERS: json(),
    PORT: port()
  });
}

validateEnv();

const {
  KAFKA_CLUSTER_NAME,
  KAFKA_BROKERS,
  KAFKA_CLIENT_ID,
  PORT } = process.env;

let brokers = JSON.parse(KAFKA_BROKERS || "");
let br = {
  clientId: KAFKA_CLIENT_ID,
  brokers: brokers.brokers
};
const kafka = new Kafka(br);
const app = new App([new TopicController(kafka)], 5000);

app.listen();


