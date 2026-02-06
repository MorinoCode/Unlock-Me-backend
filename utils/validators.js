/**
 * ✅ Security Fix: Centralized Input Validation
 * Validators for all user inputs
 */

// Password validation regex: min 6 chars, uppercase, lowercase, number & symbol
const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{6,}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_REGEX = /^[a-z0-9_]{3,15}$/;

export const validatePassword = (password) => {
  if (!password || typeof password !== 'string') {
    return { valid: false, message: "Password is required" };
  }
  
  if (password.length < 6) {
    return { valid: false, message: "Password must be at least 6 characters" };
  }
  
  if (!PASSWORD_REGEX.test(password)) {
    return { 
      valid: false, 
      message: "Password must contain uppercase, lowercase, number and special character" 
    };
  }
  
  return { valid: true };
};

export const validateEmail = (email) => {
  if (!email || typeof email !== 'string') {
    return { valid: false, message: "Email is required" };
  }
  
  if (!EMAIL_REGEX.test(email)) {
    return { valid: false, message: "Invalid email format" };
  }
  
  return { valid: true };
};

export const validateUsername = (username) => {
  if (!username || typeof username !== 'string') {
    return { valid: false, message: "Username is required" };
  }
  
  if (username.length < 3 || username.length > 15) {
    return { valid: false, message: "Username must be between 3 and 15 characters" };
  }
  
  if (!USERNAME_REGEX.test(username)) {
    return { valid: false, message: "Username can only contain lowercase letters, numbers and underscores" };
  }
  
  const FORBIDDEN_USERNAMES = ["admin", "support", "root", "unlockme", "moderator", "superuser", "help", "info", "manager"];
  if (FORBIDDEN_USERNAMES.includes(username.toLowerCase())) {
    return { valid: false, message: "This username is not available" };
  }
  
  return { valid: true };
};

export const validateName = (name) => {
  if (!name || typeof name !== 'string') {
    return { valid: false, message: "Name is required" };
  }
  
  const trimmed = name.trim();
  if (trimmed.length < 2) {
    return { valid: false, message: "Name must be at least 2 characters" };
  }
  
  if (trimmed.length > 50) {
    return { valid: false, message: "Name cannot exceed 50 characters" };
  }
  
  return { valid: true };
};

export const validateBio = (bio) => {
  if (!bio) return { valid: true }; // Bio is optional
  
  if (typeof bio !== 'string') {
    return { valid: false, message: "Bio must be a string" };
  }
  
  if (bio.length > 150) {
    return { valid: false, message: "Bio cannot exceed 150 characters" };
  }
  
  return { valid: true };
};

export const validateGender = (gender) => {
  const validGenders = ["Male", "Female", "Other"];
  if (!gender || !validGenders.includes(gender)) {
    return { valid: false, message: "Gender must be Male, Female, or Other" };
  }
  return { valid: true };
};

export const sanitizeString = (str, maxLength = null) => {
  if (!str || typeof str !== 'string') return '';
  let sanitized = str.trim();
  if (maxLength && sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength);
  }
  return sanitized;
};
