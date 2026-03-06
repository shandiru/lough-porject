import mongoose from 'mongoose';

const leaveSchema = new mongoose.Schema(
  {
    staffId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Staff',
      required: true,
    },
    type: {
      type: String,
      enum: ['sick', 'vacation', 'training', 'other'],
      required: true,
    },
    startDate: { type: Date, required: true },
    endDate:   { type: Date, required: true },

    // ── Hourly / partial-day leave ────────────────────────────────────────
    // If isHourly = true  →  only blocks startTime–endTime on that single day
    // If isHourly = false →  blocks the entire day(s)
    isHourly:  { type: Boolean, default: false },
    startTime: { type: String, match: /^([01]\d|2[0-3]):[0-5]\d$/ }, // "HH:MM"
    endTime:   { type: String, match: /^([01]\d|2[0-3]):[0-5]\d$/ }, // "HH:MM"

    reason:    { type: String, maxlength: 500 },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'cancelled'],
      default: 'pending',
    },
    adminNote:  { type: String, maxlength: 500 },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: { type: Date },
  },
  { timestamps: true }
);

leaveSchema.index({ staffId: 1, status: 1 });
leaveSchema.index({ status: 1 });

const Leave = mongoose.model('Leave', leaveSchema);
export default Leave;