import { Router, type IRouter } from "express";
import healthRouter from "./health";
import telegramAccountsRouter from "./telegram-accounts";
import telegramJobsRouter from "./telegram-jobs";

const router: IRouter = Router();

router.use(healthRouter);
router.use(telegramAccountsRouter);
router.use(telegramJobsRouter);

export default router;
