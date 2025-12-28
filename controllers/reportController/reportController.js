import Report from '../../models/Report.js';

export const submitReport = async (req, res) => {
  try {
    const { category, description, url, userAgent, screenSize, timestamp, targetUserId } = req.body;
    
    const reporterId = req.user ? req.user._id : null;

    const newReport = new Report({
      reporterId,
      category,
      description,
      metaData: {
        url,
        userAgent,
        screenSize,
        timestamp
      },
      targetUserId: targetUserId || null
    });

    await newReport.save();

    res.status(201).json({ 
      success: true, 
      message: 'Report submitted successfully' 
    });

  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: 'Server Error',
      error: error.message 
    });
  }
};