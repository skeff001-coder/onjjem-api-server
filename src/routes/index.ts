import { Router, type IRouter } from "express";
import healthRouter from "./health";
import canineRouter from "./canine";
import privacyRouter from "./privacy";

const router: IRouter = Router();

router.use(healthRouter);
router.use(canineRouter);
router.use(privacyRouter);

export default router;
