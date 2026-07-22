import { Router, type IRouter } from "express";
import healthRouter from "./health";
import usersRouter from "./users";
import groupsRouter from "./groups";
import messagesRouter from "./messages";
import activityRouter from "./activity";
import dmsRouter from "./dms";
import dmCallsRouter from "./dmCalls";
import pushRouter from "./push";

const router: IRouter = Router();

router.use(healthRouter);
router.use(usersRouter);
router.use(groupsRouter);
router.use(messagesRouter);
router.use(activityRouter);
router.use(dmsRouter);
router.use(dmCallsRouter);
router.use(pushRouter);

export default router;
