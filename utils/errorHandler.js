/**
 * ✅ Security & Bug Fix: Centralized Error Handler
 * Provides consistent error responses without exposing sensitive information
 */

export const handleError = (error, req, res, customMessage = null) => {
  const statusCode = error.statusCode || 500;
  
  // Log error with context
  const errorContext = {
    message: error.message,
    stack: error.stack,
    path: req.path,
    method: req.method,
    userId: req.user?.userId,
    timestamp: new Date().toISOString()
  };
  
  if (statusCode === 500) {
    console.error("🔥 Server Error:", errorContext);
  } else {
    console.warn("⚠️ Client Error:", errorContext);
  }
  
  // Don't expose error details in production
  let message = customMessage || "Internal Server Error";
  
  if (process.env.NODE_ENV !== 'production') {
    message = customMessage || error.message || "Internal Server Error";
  } else {
    // In production, use generic messages
    if (!customMessage) {
      if (statusCode === 400) {
        message = "Invalid request. Please check your input.";
      } else if (statusCode === 401) {
        message = "Authentication failed.";
      } else if (statusCode === 403) {
        message = "Access denied.";
      } else if (statusCode === 404) {
        message = "Resource not found.";
      } else {
        message = "Server error. Please try again later.";
      }
    }
  }
  
  return res.status(statusCode).json({
    success: false,
    message: message,
    ...(process.env.NODE_ENV !== 'production' && { 
      error: error.message,
      stack: error.stack 
    })
  });
};

export const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch((error) => {
      handleError(error, req, res);
    });
  };
};
