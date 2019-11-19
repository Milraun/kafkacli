import Controller from "./controller.interface"
import express from 'express';
import Topic from './topic.interface'
import kf from "./kafkafunctions";
import { Server } from 'socket.io';
import {
  Kafka,
  logLevel,
  ITopicMetadata,
  KafkaMessage,
  IHeaders
} from "kafkajs";
const logger = require('pino')()

class TopicController implements Controller {
  public readonly path = "/topics/:regex?";
  public readonly namespace = "/topics"
  public router = express.Router();
  public io?: Server;
  public kafka: Kafka;
  private runObserveTopics = false;

  constructor(kafka: Kafka) {
    this.kafka = kafka;
  }

  public init (io: Server): void {
    this.io = io;
    this.initalizeRoutes();
    this.intializeSockets();
  }

  private initalizeRoutes (): void {
    this.router.get(this.path, this.getTopics);
  }

  private intializeSockets (): void {
    if (this.io) {
      let ns = this.io.of(this.namespace)
      ns.on('connection', (socket) => {
        logger.info(`Client connection to namespace ${this.namespace}, Socket.Id = ${socket.id}`);
        //Trigger cyclic topics listing an send the to client.
        this.observeTopics(socket);
        socket.on("disconnected", () => {
          logger.info(`Client disconnected from namespace ${this.namespace}, Socket.Id = ${socket.id}`);
          this.runObserveTopics = false;
        })
      })
    }
  }

  private getTopics = async (request: express.Request, response: express.Response, next: express.NextFunction): Promise<void> => {
    if (!this.kafka) {
      response.send("No kafka cluster intialized !");
    } else {
      try {
        let topics = await kf.listTopicsServer(request.params.regex ? new RegExp(request.params.regex) : new RegExp(".*"), this.kafka);
        let resTopics: Topic[] = [];
        topics.forEach((t) => resTopics.push(new Topic(t.name, t.partitions.length)))
        response.send(JSON.stringify(resTopics));
      } catch (e) {
        next(e);
      }

    }
  }

  private async observeTopics (socket: SocketIO.Socket): Promise<void> {
    this.runObserveTopics = true;
    let toHandle = setInterval(async () => {
      if (socket.connected && this.kafka) {
        let topics = await kf.listTopicsServer(new RegExp(".*"), this.kafka);
        let resTopics: Topic[] = [];
        topics.forEach((t) => resTopics.push(new Topic(t.name, t.partitions.length)))
        socket.emit("topics", resTopics);
        logger.info(`emmitted to 'topics': ${resTopics}`);
        if (!this.runObserveTopics) {
          clearInterval(toHandle);
        }
      }
    }, 10000);
  }
}


export default TopicController;