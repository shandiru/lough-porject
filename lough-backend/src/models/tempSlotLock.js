import mongoose from 'mongoose';

/**
 * TempSlotLock — holds a staff slot for 30 minutes while the customer
 * completes Stripe payment. Automatically expires via TTL index.
 */
const tempSlotLockSchema = new mongoose.Schema(
  {
    staffId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Staff',   required: true },
    serviceId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Service', required: true },
    bookingDate: { type: String,  required: true }, // "YYYY-MM-DD"
    bookingTime: { type: String,  required: true }, // "HH:MM"
    duration:    { type: Number,  required: true }, // ✅ FIX: service duration in minutes
    sessionId:   { type: String,  required: true }, // Stripe checkout session id
    expiresAt:   { type: Date,    required: true },  // TTL field
  },
  { timestamps: true }
);

// Auto-delete document when expiresAt is reached (MongoDB TTL index)
tempSlotLockSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
tempSlotLockSchema.index({ staffId: 1, bookingDate: 1, bookingTime: 1 });
tempSlotLockSchema.index({ sessionId: 1 }, { unique: true });

const TempSlotLock = mongoose.model('TempSlotLock', tempSlotLockSchema);

export default TempSlotLock;