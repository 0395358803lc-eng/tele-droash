import express, { type ErrorRequestHandler, type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.disable("x-powered-by");

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

const allowedOrigins = new Set([
  "http://127.0.0.1:5173",
  "http://localhost:5173",
]);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) return callback(null, true);
      return callback(
        new Error("Origin is not allowed for this desktop server."),
      );
    },
    credentials: false,
  }),
);
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

app.use("/api", router);

app.use((_req, res) => {
  res.status(404).json({ message: "Không tìm thấy API endpoint." });
});

const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  req.log?.error({ err: error }, "Unhandled API request error");
  if (res.headersSent) return;
  res.status(500).json({ message: "Lỗi nội bộ của ứng dụng." });
};
app.use(errorHandler);

export default app;
