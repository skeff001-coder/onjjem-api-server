import express, { type Express } from "express";
import cors from "cors";
import router from "./routes/index";
import { pinoHttp } from "pino-http";
import { logger } from "./lib/logger";
const app: Express = express();
app.use(pinoHttp({ logger }));
app.use(cors());
app.use(express.json({ limit: "12mb" }));
app.use(express.urlencoded({ extended: true, limit: "12mb" }));
app.use("/api", router);
export default app;

