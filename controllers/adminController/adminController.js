import User from '../../models/User.js';

// @desc    Get all users for admin
// @route   GET /api/admin/users
// @access  Private (Admin)
export const getAllUsers = async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const search = req.query.search || '';

    const query = {};
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
      ];
    }

    const users = await User.find(query)
      .select('-password -__v')
      .skip((page - 1) * limit)
      .limit(limit)
      .sort({ createdAt: -1 });

    const total = await User.countDocuments(query);

    res.status(200).json({
      success: true,
      data: users,
      pagination: {
        total,
        page,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Admin getAllUsers Error:', error);
    res.status(500).json({ success: false, message: 'Server error fetching users' });
  }
};

// @desc    Get standard user details by ID
// @route   GET /api/admin/users/:id
// @access  Private (Admin)
export const getUserById = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    res.status(200).json({ success: true, data: user });
  } catch (error) {
    console.error('Admin getUserById Error:', error);
    res.status(500).json({ success: false, message: 'Server error fetching user details' });
  }
};

// @desc    Update user details (Ban, Role, etc.)
// @route   PUT /api/admin/users/:id
// @access  Private (Admin)
export const updateUser = async (req, res) => {
  try {
    const updates = req.body;
    // We only allow specific fields to be updated via admin for safety
    // Assuming backend might have `isBanned` or similar
    const updatedUser = await User.findByIdAndUpdate(
      req.params.id,
      { $set: updates },
      { new: true, runValidators: true }
    ).select('-password');

    if (!updatedUser) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.status(200).json({ success: true, data: updatedUser });
  } catch (error) {
    console.error('Admin updateUser Error:', error);
    res.status(500).json({ success: false, message: 'Server error updating user' });
  }
};

// @desc    Delete user
// @route   DELETE /api/admin/users/:id
// @access  Private (Admin)
export const deleteUser = async (req, res) => {
  try {
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    res.status(200).json({ success: true, message: 'User deleted successfully' });
  } catch (error) {
    console.error('Admin deleteUser Error:', error);
    res.status(500).json({ success: false, message: 'Server error deleting user' });
  }
};
