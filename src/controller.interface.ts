import express from 'express';
import { Socket } from 'dgram';

interface Controller {
  router: express.Router;
  path: string;
  io?: SocketIO.Server;

  init (io: SocketIO.Server): void;
}

export default Controller;