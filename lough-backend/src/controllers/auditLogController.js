import AuditLog from '../models/auditLog.js';

// GET /api/audit-logs
export const getAuditLogs = async (req, res) => {
  try {
    const {
      entity,
      action,
      entityId,
      performedBy,
      from,
      to,
      search,
      page = 1,
      limit = 50,
    } = req.query;

    const filter = {};

    if (entity)      filter.entity      = entity;
    if (action)      filter.action      = action;
    if (entityId)    filter.entityId    = entityId;
    if (performedBy) filter.performedBy = performedBy;

    if (from || to) {
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = new Date(from);
      if (to)   filter.createdAt.$lte = new Date(new Date(to).setHours(23, 59, 59, 999));
    }

    if (search) {
      filter.$or = [
        { description:       { $regex: search, $options: 'i' } },
        { action:            { $regex: search, $options: 'i' } },
        { performedByName:   { $regex: search, $options: 'i' } },
        { entityId:          { $regex: search, $options: 'i' } },
      ];
    }

    const skip  = (Number(page) - 1) * Number(limit);
    const total = await AuditLog.countDocuments(filter);

    const logs = await AuditLog.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .populate('performedBy', 'firstName lastName email role');

    res.status(200).json({
      total,
      page:       Number(page),
      limit:      Number(limit),
      totalPages: Math.ceil(total / Number(limit)),
      logs,
    });
  } catch (err) {
    console.error('[getAuditLogs]', err);
    res.status(500).json({ message: err.message });
  }
};

// GET /api/audit-logs/actions  — distinct action strings for filter dropdown
export const getDistinctActions = async (req, res) => {
  try {
    const actions = await AuditLog.distinct('action');
    res.status(200).json(actions.sort());
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
