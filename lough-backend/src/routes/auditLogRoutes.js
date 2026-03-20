import express from 'express';
import { getAuditLogs, getDistinctActions } from '../controllers/auditLogController.js';
import { verifyToken, verifyAdmin } from '../middleware/verifyToken.js';

const auditLogRouter = express.Router();

auditLogRouter.get('/',       verifyToken, verifyAdmin, getAuditLogs);
auditLogRouter.get('/actions', verifyToken, verifyAdmin, getDistinctActions);

export default auditLogRouter;
