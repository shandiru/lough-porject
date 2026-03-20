import AuditLog from '../models/auditLog.js';

/**
 * Write an audit log entry.
 *
 * @param {object} opts
 * @param {object|null}  opts.user        - req.user decoded JWT  (may be null for system events)
 * @param {string}       opts.entity      - 'booking' | 'staff' | 'leave' | 'service' | 'category' | 'auth' | 'profile' | 'payment'
 * @param {string|null}  opts.entityId    - MongoDB _id of the affected document
 * @param {string}       opts.action      - short snake_case verb e.g. 'booking.created'
 * @param {string}       opts.description - human-readable sentence
 * @param {object|null}  opts.before      - snapshot before change (omit sensitive fields)
 * @param {object|null}  opts.after       - snapshot after change
 * @param {object|null}  opts.meta        - any extra data (refund amount, flags, …)
 * @param {object|null}  opts.req         - Express request object (to extract IP)
 */
export const writeAuditLog = async ({
  user = null,
  entity,
  entityId = null,
  action,
  description,
  before = null,
  after  = null,
  meta   = null,
  req    = null,
}) => {
  try {
    const ip = req
      ? (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || null)
      : null;

    await AuditLog.create({
      performedBy:     user?.id    || null,
      performedByName: user?.name  || 'System',
      performedByRole: user?.role  || 'system',
      entity,
      entityId:        entityId ? String(entityId) : null,
      action,
      description,
      before,
      after,
      meta,
      ip,
    });
  } catch (err) {
    // Never let audit logging crash the main request
    console.error('[AuditLog] Failed to write log:', err.message);
  }
};
