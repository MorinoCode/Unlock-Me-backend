/**
 * Feature Flag Middleware
 * Blocks access to features that are currently disabled via environment variables.
 */
export const checkFeatureFlag = (flagName) => {
  return (req, res, next) => {
    const isEnabled = process.env[flagName] === "true";
    
    if (!isEnabled) {
      return res.status(403).json({
        success: false,
        message: `This feature (${flagName}) is currently disabled for this release.`,
        code: "FEATURE_DISABLED"
      });
    }
    
    next();
  };
};
