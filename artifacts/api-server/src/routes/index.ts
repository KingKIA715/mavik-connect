import { Router, type IRouter } from "express";
import healthRouter from "./health";
import usersRouter from "./users";
import groupsRouter from "./groups";
import messagesRouter from "./messages";
import activityRouter from "./activity";
import dmsRouter from "./dms";

const router: IRouter = Router();

router.use(healthRouter);
router.use(usersRouter);
router.use(groupsRouter);
router.use(messagesRouter);
router.use(activityRouter);
router.use(dmsRouter);

export default router;
