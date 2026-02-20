import mongoose from 'mongoose';

const reportSchema = new mongoose.Schema({
  reporterId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false
  },
  category: {
    type: String,
    enum: [
      'harassment', 
      'hate_speech', 
      'fake_profile', 
      'scam', 
      'underage', 
      'inappropriate_content', 
      'technical', 
      'billing', 
      'other'
    ],
    required: true
  },
  description: {
    type: String,
    required: true,
    trim: true
  },
  metaData: {
    url: String,
    userAgent: String,
    screenSize: String,
    timestamp: String
  },
  targetUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  status: {
    type: String,
    enum: ['pending', 'reviewed', 'resolved', 'ignored'],
    default: 'pending'
  },
  adminNotes: String
}, {
  timestamps: true
});

export default mongoose.model('Report', reportSchema);
