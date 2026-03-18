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

    // Client Consultation Form — submitted after payment
    consultationFormCompleted: { type: Boolean, required: true, default: false },

    // Staff gender preference recorded at booking time
    staffGenderPreference: {
      type: String,
      enum: ['any', 'male', 'female'],
      default: 'any',
    },

    // Cancellation (admin-initiated or admin-approved)
    cancellationReason: { type: String },
    cancelledAt:        { type: Date },
    cancelledBy:        { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    // Customer cancel request flow
    cancelRequestedAt:     { type: Date },
    cancelRequestedBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    cancelRequestReason:   { type: String },
    cancelRequestStatus:   { type: String, enum: ['pending', 'approved', 'rejected'], default: null },
    refundAmount:          { type: Number, default: 0 }, // pence
    refundedAt:            { type: Date },

    // Customer reschedule request flow
    rescheduleRequestedAt:   { type: Date },
    rescheduleRequestedBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    rescheduleReason:        { type: String },
    rescheduleRequestStatus: { type: String, enum: ['pending', 'approved', 'rejected'], default: null },
    // Proposed new date/time/staff (set by customer, can be changed by staff/admin before approval)
    rescheduleDate:          { type: Date },
    rescheduleTime:          { type: String, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
    rescheduleStaffMember:   { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
    // When approved, old values saved here for reference
    previousBookingDate:     { type: Date },
    previousBookingTime:     { type: String },
    previousStaffMember:     { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
    previousGoogleEventId:   { type: String },

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



bookingSchema.index({ bookingDate: 1 });
bookingSchema.index({ staffMember: 1, bookingDate: 1 });
bookingSchema.index({ status: 1 });
bookingSchema.index({ customerEmail: 1 });
bookingSchema.index({ stripePaymentIntentId: 1 });

const Booking = mongoose.model('Booking', bookingSchema);

export default Booking;