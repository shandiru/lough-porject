import mongoose from 'mongoose';

const CategorySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Category name is required'],
      unique: true,
      trim: true,
      maxlength: [100, 'Name cannot exceed 100 characters'],
    },
    description: {
      type: String,
      maxlength: [500, 'Description cannot exceed 500 characters'],
      default: '',
    },
    displayOrder: {
      type: Number,
      default: 0,
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


CategorySchema.index({ isActive: 1, displayOrder: 1 });
const Category = mongoose.model('Category', CategorySchema);

export default Category;