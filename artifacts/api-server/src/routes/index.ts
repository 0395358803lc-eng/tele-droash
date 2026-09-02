import { Router, type IRouter } from "express";
import healthRouter from "./health";
import telegramAccountsRouter from "./telegram-accounts";

const router: IRouter = Router();

router.use(healthRouter);
router.use(telegramAccountsRouter);

export default router;
