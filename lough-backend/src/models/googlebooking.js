import mongoose from 'mongoose';

const bookingSchema = new mongoose.Schema(
  {
    // ─── Staff Reference ──────────────────────────────────────────────────────
    staffId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Staff',
      required: true,
    },

    // ─── Appointment Time ─────────────────────────────────────────────────────
    date:      { type: Date,   required: true }, // e.g. 2025-03-15
    startTime: { type: String, required: true }, // e.g. "10:00"
    endTime:   { type: String, required: true }, // e.g. "11:00"

    // ─── Google Calendar Sync ─────────────────────────────────────────────────
    googleCalendarEventId: { type: String, default: null },
    googleCalendarSynced:  { type: Boolean, default: false },
  },
  { timestamps: true }
);

// ─── Indexes ──────────────────────────────────────────────────────────────────
bookingSchema.index({ staffId: 1, date: 1 });
bookingSchema.index({ googleCalendarSynced: 1 });

const Googlebooking = mongoose.model('Googlebooking', bookingSchema);

export default Googlebooking;