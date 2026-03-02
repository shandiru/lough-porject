import express from "express";
import {
  getServices,
  createService,
  updateService,
  deleteService,
} from "../controllers/serviceController.js";
import { verifyToken, verifyAdmin } from "../middleware/verifyToken.js";

const serviceRouter = express.Router();

serviceRouter.get("/", getServices);
serviceRouter.post("/", verifyToken, verifyAdmin, createService);
serviceRouter.put("/:id", verifyToken, verifyAdmin, updateService);
serviceRouter.delete("/:id", verifyToken, verifyAdmin, deleteService);

export default serviceRouter;