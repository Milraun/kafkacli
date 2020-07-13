import Controller from "./controller.interface"
import express from 'express';
import { View, ViewDB } from './view.interface'
import kf from "./kafkafunctions";
import { Server } from 'socket.io';
import uuidv4 from 'uuid/v4';
import Nedb from 'nedb-promises-ts';

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
  private db: Nedb<ViewDB>;

  private views: { [key: string]: View } = {};

  constructor(kafka: Kafka) {
    this.kafka = kafka;
    this.db = this.initializeDB();
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

  private initializeDB (): Nedb<ViewDB> {
    let db = new Nedb<ViewDB>({
      filename: 'views.db',
      autoload: true,
      timestampData: true,
      onload: (err) => {
        if (err) {
          log.error(`Couldn't load database views.db. Error = ${err}`);
        } else {
          this.db?.ensureIndex({ fieldName: 'view', unique: true })
        }
      }
    }
    )
    return db;
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
        let v = await this.db.findOne({ view: request.params.name }) as ViewDB;

        if (v) {
          //          await delView(name);
          log.error("View exists");
          response.status(200).send(JSON.stringify(v));
          return;
        } else {
          response.status(404).send(`No view with name ${request.params.name} found!`);
        }

        // let view = this.views[request.params.name];
        // if (view) {
        //   response.send(JSON.stringify(view))
        // } else {
        //   response.status(404).send(`No view with name ${request.params.name} found!`);
        // }
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
        let views = await this.db.find({});
        //        let outViews = Object.keys(this.views);
        response.send(JSON.stringify(views));
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
        let regExp = request.params.regex;
        let name = request.params.name;

        let v = await this.db.findOne({ view: name }) as ViewDB;

        if (v) {
          //          await delView(name);
          log.error("View exists");
          response.status(500).send("View exists !");
          return;
        } else {
          let vdb = new ViewDB(uuidv4(), name, regExp);
          await this.db.insert(vdb);
          response.status(200);
        }

        //   if (this.views[name]) {
        //     //          await delView(name);
        //     log.error("View exists");
        //     response.status(500).send("View exists !");
        //     return;
        //   }
        //   let observable = await kf.tailTopicsObservableServer(regExp, this.kafka, uuidv4(), undefined, true);
        //   observable.subscribe({
        //     next: m => {
        //       if (this.socket) {
        //         this.socket.emit(name, "Message");
        //       }
        //     },
        //     complete: () => (log.info(`Done!`)),
        //     error: e => log.error(`An error occurred: ${e}`)
        //   });
        //   let view = new View(uuidv4(), name, regExp, observable);
        //   this.views[name] = view;
      } catch (e) {
        response.status(500).send(e);
        return;
      }
      // response.status(200);

    }
  }

  private delView = async (request: express.Request, response: express.Response, next: express.NextFunction): Promise<void> => {
  }
}


export default ViewController;