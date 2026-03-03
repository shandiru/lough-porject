import express from "express";
import {
  getServices,
  createService,
  updateService,
  deleteService,
  getActiveServicesGrouped,
  getServiceById
} from "../controllers/serviceController.js";
import { verifyToken, verifyAdmin } from "../middleware/verifyToken.js";

const serviceRouter = express.Router();

serviceRouter.get("/", getServices);
serviceRouter.post("/", verifyToken, verifyAdmin, createService);
serviceRouter.put("/:id", verifyToken, verifyAdmin, updateService);
serviceRouter.delete("/:id", verifyToken, verifyAdmin, deleteService);
serviceRouter.get("/active-grouped", getActiveServicesGrouped);
serviceRouter.get("/:id", getServiceById);
export default serviceRouter;