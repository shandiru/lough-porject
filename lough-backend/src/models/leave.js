const mongoose = require('mongoose');
const { Schema } = mongoose;

const leavesSchema = new Schema({
  staffMember: {
    type: Schema.Types.ObjectId,
    ref: 'Staff',
    required: [true, 'Staff member reference is required']
  },
  startDate: {
    type: Date,
    required: [true, 'Start date is required']
  },
  endDate: {
    type: Date,
    required: [true, 'End date is required']
  },
  type: {
    type: String,
    required: true,
    enum: {
      values: ['sick', 'vacation', 'training', 'other'],
      message: '{VALUE} is not a supported leave type'
    }
  },
  reason: {
    type: String,
    required: false,
    maxlength: [200, 'Reason cannot exceed 200 characters']
  },
  status: {
    type: String,
    required: true,
    enum: ['pending', 'approved', 'rejected'],
    default: 'approved'
  },
  requestedBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: false
  },
  approvedBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: false
  }
}, {
  timestamps: true 
});


leavesSchema.index({ staffMember: 1 });
leavesSchema.index({ startDate: 1, endDate: 1 });
leavesSchema.index({ status: 1 });

const Leave = mongoose.model('Leave', leavesSchema);

module.exports = Leave;