import User from '../models/user.js';
import Staff from '../models/staff.js';


export const getMyProfile = async (req, res) => {
  try {
    const userId = req.user.id;

    const user = await User.findById(userId).select(
      'firstName lastName email phone gender profileImage role'
    );
    if (!user) return res.status(404).json({ message: 'User not found' });

    let staffData = null;
    if (user.role === 'staff') {
      staffData = await Staff.findOne({ userId })
        .populate('skills', 'name price duration')
        .select('bio specializations genderRestriction skills workingHours isOnLeave');
    }

    res.status(200).json({ user, staff: staffData });
  } catch (err) {
    res.status(500).json({ message: 'Error fetching profile', error: err.message });
  }
};


export const updateMyProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    const { firstName, lastName, phone, bio } = req.body;

  
    const userUpdate = {};
    if (firstName)           userUpdate.firstName    = firstName;
    if (lastName)            userUpdate.lastName     = lastName;
    if (phone !== undefined) userUpdate.phone        = phone;
    if (req.file)            userUpdate.profileImage = `/uploads/profiles/${req.file.filename}`;

    const updatedUser = await User.findByIdAndUpdate(userId, userUpdate, {
      returnDocument: 'after',
      runValidators: true,
    }).select('firstName lastName email phone gender profileImage role');

  
    let staffData = null;
    if (updatedUser.role === 'staff' && bio !== undefined) {
      staffData = await Staff.findOneAndUpdate(
        { userId },
        { bio },
        { returnDocument: 'after', runValidators: true }
      ).populate('skills', 'name price duration');
    }

    res.status(200).json({
      message: 'Profile updated successfully',
      user: updatedUser,
      staff: staffData,
    });
  } catch (err) {
    res.status(400).json({ message: 'Error updating profile', error: err.message });
  }
};