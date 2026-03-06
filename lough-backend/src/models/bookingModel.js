import mongoose from 'mongoose';

const consentDataSchema = new mongoose.Schema(
  {
    marketingEmails: { type: Boolean, default: false },
    termsAccepted: { type: Boolean, default: false },
    privacyPolicyAccepted: { type: Boolean, default: false },
  },
  { _id: false }
);

const bookingSchema = new mongoose.Schema(
  {
    bookingNumber: {
      type: String,
      required: true,
      unique: true,
      match: /^BK-\d{8}-\d{4}$/,
    },

    // Customer info
    customerName:    { type: String, required: true },
    customerEmail:   { type: String, required: true },
    customerPhone:   { type: String, required: true },
    customerAddress: { type: String },
    customerGender: {
      type: String,
      enum: ['male', 'female', 'other', 'prefer-not-to-say'],
    },
    customerNotes: { type: String },

    // References
    service:     { type: mongoose.Schema.Types.ObjectId, ref: 'Service', required: true },
    staffMember: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff',   required: true },

    // Appointment
    bookingDate: {
      type: Date,
      required: true,
      validate: {
        validator: (v) => v >= new Date(new Date().setHours(0, 0, 0, 0)),
        message:   'bookingDate cannot be in the past',
      },
    },
    bookingTime: {
      type: String,
      required: true,
      match: /^([01]\d|2[0-3]):[0-5]\d$/,
    },
    duration: { type: Number, required: true }, // minutes

    // Status
    status: {
      type: String,
      required: true,
      enum: ['pending', 'confirmed', 'completed', 'cancelled', 'no-show'],
      default: 'pending',
    },

    // Payment amounts (in pence)
    totalAmount:      { type: Number, required: true },
    depositAmount:    { type: Number, required: true },
    paidAmount:       { type: Number, required: true, default: 0 },
    balanceRemaining: { type: Number, required: true },

    paymentType: {
      type: String,
      required: true,
      enum: ['deposit', 'full'],
    },
    paymentStatus: {
      type: String,
      required: true,
      enum: ['pending', 'paid', 'failed', 'refunded', 'partially_refunded'],
      default: 'pending',
    },

    stripePaymentIntentId: { type: String },
    stripeChargeId:        { type: String },

    // Consent
    consentFormCompleted: { type: Boolean, required: true, default: false },
    consentData:          { type: consentDataSchema },

    // Cancellation
    cancellationReason: { type: String },
    cancelledAt:        { type: Date },
    cancelledBy:        { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    // Meta
    bookingSource: {
      type: String,
      required: true,
      enum: ['website', 'admin', 'external'],
      default: 'website',
    },
    internalNotes: { type: String },

    // Integrations
    googleCalendarEventId: { type: String },

    // Reminders
    reminderSent:   { type: Boolean, required: true, default: false },
    reminderSentAt: { type: Date },

    // Created by (admin bookings)
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  {
    timestamps: true, // createdAt + updatedAt
  }
);

// ─── Indexes ────────────────────────────────────────────────────────────────
bookingSchema.index({ bookingNumber: 1 }, { unique: true });
bookingSchema.index({ bookingDate: 1 });
bookingSchema.index({ staffMember: 1, bookingDate: 1 });
bookingSchema.index({ status: 1 });
bookingSchema.index({ customerEmail: 1 });
bookingSchema.index({ stripePaymentIntentId: 1 });

const Booking = mongoose.model('Booking', bookingSchema);

export default Booking;