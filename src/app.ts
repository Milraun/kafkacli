import * as bodyParser from 'body-parser';
import Controller from './controller.interface'
const logger = require('pino')()
const pino = require('express-pino-logger')();
import express from 'express';
import socketIo from 'socket.io';
import { createServer, Server } from 'http';

class App {
  public app: express.Application;
  private server: Server;
  private io: SocketIO.Server;
  public port: number;

  constructor(controllers: Controller[], port: number) {
    this.app = express();
    this.port = port;
    this.server = createServer(this.app);
    this.io = socketIo(this.server);

    this.initializeMiddlewares();
    this.initializeControllers(controllers);
  }

  private initializeMiddlewares () {
    this.app.use(pino);
    this.app.use(bodyParser.json());
  }

  private initializeControllers (controllers: Controller[]) {
    controllers.forEach((controller) => {
      controller.init(this.io);
      this.app.use('/api', controller.router);
    });
  }

  public listen () {
    this.server.listen(this.port, () => {
      logger.info(`App listening on the port ${this.port}`);
    });
  }
}

export default App;