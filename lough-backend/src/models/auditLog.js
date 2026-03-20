import mongoose from 'mongoose';

const auditLogSchema = new mongoose.Schema(
  {
    // Who performed the action
    performedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    performedByName: { type: String, default: 'System' },
    performedByRole: { type: String, default: 'system' },

    // What entity was affected
    entity: {
      type: String,
      required: true,
      enum: ['booking', 'staff', 'leave', 'service', 'category', 'auth', 'profile', 'payment'],
    },
    entityId: { type: String, default: null },

    // What happened
    action: { type: String, required: true },

    // Human-readable summary
    description: { type: String, required: true },

    // Optional before/after snapshot (kept small — no passwords)
    before: { type: mongoose.Schema.Types.Mixed, default: null },
    after:  { type: mongoose.Schema.Types.Mixed, default: null },

    // Extra metadata (refund amount, email sent, etc.)
    meta: { type: mongoose.Schema.Types.Mixed, default: null },

    // Request context
    ip: { type: String, default: null },
  },
  { timestamps: true }
);

auditLogSchema.index({ entity: 1, createdAt: -1 });
auditLogSchema.index({ performedBy: 1, createdAt: -1 });
auditLogSchema.index({ action: 1 });
auditLogSchema.index({ createdAt: -1 });

const AuditLog = mongoose.model('AuditLog', auditLogSchema);
export default AuditLog;
