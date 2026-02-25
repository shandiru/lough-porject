import mongoose from 'mongoose'; 
const UserSchema = new mongoose.Schema(
  {
    firstName: { type: String, required: true, maxlength: 50, trim: true },

    lastName: { type: String, required: true, maxlength: 50, trim: true },

    email: { type: String, required: true, unique: true, lowercase: true, match: [/\S+@\S+\.\S+/, 'Please enter a valid email address'] },

    password: { type: String, required: true, minlength: 8 },

    phone: { type: String, match: [/^(07\d{3} \d{6}|(\+44\s?7\d{3}\s?\d{6}))$/, 'Please enter a valid UK phone number'] },

    role: { type: String, required: true, enum: ['admin', 'staff', 'customer'], default: 'customer' },

    gender: { type: String, enum: ['male', 'female', 'other'] },

    isActive: { type: Boolean, default: false },

    profileImage: { type: String },

    lastLogin: { type: Date },

    emailVerifyToken: { type: String },

    emailVerifyTokenExpire: { type: Date },
    
  },
  { timestamps: true } 
);
UserSchema.index({ email: 1 }, { unique: true });
UserSchema.index({ role: 1 });
UserSchema.index({ isActive: 1 });
const User = mongoose.model('User', UserSchema);

export default User;