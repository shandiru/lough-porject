import mongoose from 'mongoose';

const paymentSchema = new mongoose.Schema(
  {
    booking: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      required: true,
    },

    // Amount in pence (GBP)
    amount: { type: Number, required: true },

    type: {
      type: String,
      required: true,
      enum: ['payment', 'refund'],
    },

    status: {
      type: String,
      required: true,
      enum: ['pending', 'success', 'failed'],
      default: 'pending',
    },


    stripeTransactionId: { type: String }, // payment intent ID or refund ID

    paymentMethod: {
      type: String,
      enum: ['card', 'apple_pay', 'google_pay'],
    },
    lastFourDigits: {
      type: String,
      match: /^\d{4}$/,
    },

    
    errorMessage: { type: String },

    processedAt: { type: Date },
    processedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // admin manual refunds
  },
  {
    timestamps: true, 
  }
);


paymentSchema.index({ booking: 1 });
paymentSchema.index({ stripeTransactionId: 1 });
paymentSchema.index({ status: 1 });



export default Payment;