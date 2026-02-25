import mongoose from 'mongoose';

const daySchema = new mongoose.Schema({
  isWorking: { type: Boolean, default: false },
  start: { type: String, default: '09:00' }, 
  end: { type: String, default: '17:00' },
  breaks: [{
    start: String,
    end: String
  }]
}, { _id: false });

const staffSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true, 
    },
    skills: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Service',
      required: true
    }],
    genderRestriction: {
      type: String,
      required: true,
      enum: ['all', 'male-only', 'female-only'],
      default: 'all',
    },
    bio: {
      type: String,
      maxlength: 500
    },
    specializations: [String],
    isOnLeave: {
      type: Boolean,
      required: true,
      default: false,
    },
    workingHours: {
      monday: daySchema,
      tuesday: daySchema,
      wednesday: daySchema,
      thursday: daySchema,
      friday: daySchema,
      saturday: daySchema,
      sunday: daySchema
    },
    currentLeave: {
      startDate: Date,
      endDate: Date,
      type: { type: String, enum: ['sick', 'vacation', 'training', 'other'] },
      reason: String
    },
    googleCalendarToken: {
      access_token: String,
      refresh_token: String,
      token_type: String,
      expiry_date: Number
    },
    googleCalendarId: String,
    googleCalendarSyncStatus: {
      lastSync: Date,
      status: { type: String, enum: ['connected', 'disconnected', 'error'], default: 'disconnected' },
      errorMessage: String
    }
  },
  { timestamps: true }
);


staffSchema.index({ userId: 1 }, { unique: true });
staffSchema.index({ isOnLeave: 1 });
staffSchema.index({ skills: 1 }); 

const Staff = mongoose.model('Staff', staffSchema);

export default Staff;