import Controller from "./controller.interface"
import express from 'express';
import Topic from './topic.interface'
import kf from "./kafkafunctions";
import {
    Kafka,
    logLevel,
    ITopicMetadata,
    KafkaMessage,
    IHeaders
} from "kafkajs";

class TopicController implements Controller {
    public path = "/topics/:regex?";
    public router = express.Router();
    public kafka: Kafka;

    constructor(kafka: Kafka) {
        this.kafka = kafka;
        this.initalizeRoutes();
    }

    private initalizeRoutes (): void {
        this.router.get(this.path, this.getTopics);
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
}

export default TopicController;