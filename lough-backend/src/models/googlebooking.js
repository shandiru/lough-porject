import mongoose from 'mongoose';

const bookingSchema = new mongoose.Schema(
  {
    
    staffId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Staff',
      required: true,
    },

    
    date:      { type: Date,   required: true }, 
    startTime: { type: String, required: true }, 
    endTime:   { type: String, required: true }, 

 
    googleCalendarEventId: { type: String, default: null },
    googleCalendarSynced:  { type: Boolean, default: false },
  },
  { timestamps: true }
);


bookingSchema.index({ staffId: 1, date: 1 });
bookingSchema.index({ googleCalendarSynced: 1 });

const Googlebooking = mongoose.model('Googlebooking', bookingSchema);

export default Googlebooking;