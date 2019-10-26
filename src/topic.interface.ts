class Topic {
    public topic: string;
    public numPartitions: number;

    public constructor(topic: string, numPartitions: number) {
        this.topic = topic;
        this.numPartitions = numPartitions;
    }
}

export default Topic;