import Controller from "./controller.interface"
import express from 'express';
import View from './view.interface'
import kf from "./kafkafunctions";
import { Server } from 'socket.io';
import uuidv4 from 'uuid/v4';

import {
  Kafka,
  logLevel,
  ITopicMetadata,
  KafkaMessage,
  IHeaders
} from "kafkajs";
import { observable } from "rxjs";
import { res } from "pino-std-serializers";
import pino from "pino";
const log = pino({
  prettyPrint: {
    colorize: true,
    translateTime: process.env.LOG_TIME_TRANSLATE || true
  },
  level: process.env.LOG_LEVEL || "info"
});

class ViewController implements Controller {
  public readonly putPath = "/view/:name/regex/:regex";
  public readonly delPath = "/view/:name";
  public readonly path = "/view/";
  public readonly getViewPath = "/view/:name";
  public readonly namespace = "/views"
  public router = express.Router();
  public io?: Server;
  public kafka: Kafka;
  private runObserveTopics = false;
  private socket?: SocketIO.Socket;

  private views: { [key: string]: View } = {};

  constructor(kafka: Kafka) {
    this.kafka = kafka;
  }

  public init (io: Server): void {
    this.io = io;
    this.initalizeRoutes();
    this.intializeSockets();
  }

  private initalizeRoutes (): void {
    this.router.put(this.putPath, this.addView);
    this.router.delete(this.delPath, this.delView);
    this.router.get(this.path, this.getAllViews);
    this.router.get(this.getViewPath, this.getView);
  }

  private intializeSockets (): void {
    if (this.io) {
      let ns = this.io.of(this.namespace)
      ns.on('connection', (socket) => {
        log.info(`Client connection to namespace ${this.namespace}, Socket.Id = ${socket.id}`);
        //subscribe to view and send result to namespace
        //TODO
        socket.on("disconnected", () => {
          log.info(`Client disconnected from namespace ${this.namespace}, Socket.Id = ${socket.id}`);
          this.runObserveTopics = false;
        })
      })
    }
  }

  private getView = async (request: express.Request, response: express.Response, next: express.NextFunction): Promise<void> => {
    if (!this.kafka) {
      response.status(500).send("No kafka cluster intialized !");
    } else {
      try {
        let view = this.views[request.params.name];
        if (view) {
          response.send(JSON.stringify(view))
        } else {
          response.status(404).send(`No view with name ${request.params.name} found!`);
        }
      } catch (e) {
        next(e);
      }
    }
  }

  private getAllViews = async (request: express.Request, response: express.Response, next: express.NextFunction): Promise<void> => {
    if (!this.kafka) {
      response.status(500).send("No kafka cluster intialized !");
    } else {
      try {
        let outViews = Object.keys(this.views);
        response.send(JSON.stringify(outViews));
      } catch (e) {
        next(e);
      }
    }
  }

  private addView = async (request: express.Request, response: express.Response, next: express.NextFunction): Promise<void> => {
    if (!this.kafka) {
      response.status(500).send("No kafka cluster intialized !");
    } else {
      try {
        let regExp = new RegExp(request.params.regex);
        let name = request.params.name;
        if (this.views[name]) {
          //          await delView(name);
          log.error("View exists");
          response.status(500).send("View exists !");
          return;
        }
        let observable = await kf.tailTopicsObservableServer(regExp, this.kafka, uuidv4(), undefined, true);
        observable.subscribe({
          next: m => {
            if (this.socket) {
              this.socket.emit(name, "Message");
            }
          },
          complete: () => (log.info(`Done!`)),
          error: e => log.error(`An error occurred: ${e}`)
        });
        let view = new View(name, regExp, observable);
        this.views[name] = view;
      } catch (e) {
        response.status(500).send(e);
        return;
      }
      response.status(200);
    }
  }

  private delView = async (request: express.Request, response: express.Response, next: express.NextFunction): Promise<void> => {
  }
}


export default TopicController;