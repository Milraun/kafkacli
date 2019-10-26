import express from 'express';
import * as bodyParser from 'body-parser';
import Controller from './controller.interface'
const logger = require('pino')()
const pino = require('express-pino-logger')();

class App {
    public app: express.Application;
    public port: number;

    constructor(controllers: Controller[], port: number) {
        this.app = express();
        this.port = port;

        this.initializeMiddlewares();
        this.initializeControllers(controllers);
    }

    private initializeMiddlewares () {
        this.app.use(pino);
        this.app.use(bodyParser.json());
    }

    private initializeControllers (controllers: Controller[]) {
        controllers.forEach((controller) => {
            this.app.use('/api', controller.router);
        });
    }

    public listen () {
        this.app.listen(this.port, () => {
            logger.info(`App listening on the port ${this.port}`);
        });
    }
}

export default App;