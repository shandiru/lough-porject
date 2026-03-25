import mongoose from 'mongoose';

const ServiceSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Service name is required'],
      unique: true,
      trim: true,
      maxlength: [200, 'Name cannot exceed 200 characters'],
    },
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category', 
      required: [true, 'Category reference is required'],
    },
    duration: {
      type: Number,
      required: [true, 'Duration is required'],
      min: [15, 'Duration must be at least 15 minutes'],
      max: [480, 'Duration cannot exceed 480 minutes'],
    },
    price: {
      type: Number,
      required: [true, 'Price is required'],
      min: [0, 'Price cannot be negative'],
    },
    depositPercentage: {
      type: Number,
      required: true,
      default: 0.30,
      min: 0,
      max: 1.0,
    },
    description: {
      type: String,
      maxlength: [1000, 'Description cannot exceed 1000 characters'],
      default: '',
    },
    genderRestriction: {
      type: String,
      required: true,
      enum: ['all', 'male-only', 'female-only'],
      default: 'all',
    },
    isActive: {
      type: Boolean,
      required: true,
      default: true,
    },
  },
  { 
    timestamps: true 
  }
);


ServiceSchema.index({ category: 1 });
ServiceSchema.index({ isActive: 1 });




const Service = mongoose.model('Service', ServiceSchema);

export default Service;