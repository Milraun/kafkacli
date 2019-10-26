import express from 'express';

interface Controller {
    router: express.Router;
    path: string;
}

export default Controller;