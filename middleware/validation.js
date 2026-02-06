/**
 * ✅ Security Fix: Input Validation Middleware
 * Validates and sanitizes all inputs before processing
 */

import { 
  validatePassword, 
  validateEmail, 
  validateUsername, 
  validateName,
  validateBio,
  validateGender,
  sanitizeString 
} from "../utils/validators.js";

export const validateSignup = (req, res, next) => {
  const { name, username, email, password, gender, lookingFor } = req.body;
  
  const errors = [];
  
  // Validate name
  const nameValidation = validateName(name);
  if (!nameValidation.valid) errors.push(nameValidation.message);
  
  // Validate username
  const usernameValidation = validateUsername(username);
  if (!usernameValidation.valid) errors.push(usernameValidation.message);
  
  // Validate email
  const emailValidation = validateEmail(email);
  if (!emailValidation.valid) errors.push(emailValidation.message);
  
  // Validate password
  const passwordValidation = validatePassword(password);
  if (!passwordValidation.valid) errors.push(passwordValidation.message);
  
  // Validate gender
  if (gender) {
    const genderValidation = validateGender(gender);
    if (!genderValidation.valid) errors.push(genderValidation.message);
  }
  
  // Validate lookingFor
  if (lookingFor) {
    const lookingForValidation = validateGender(lookingFor);
    if (!lookingForValidation.valid) errors.push(lookingForValidation.message);
  }
  
  if (errors.length > 0) {
    return res.status(400).json({ 
      message: "Validation failed", 
      errors 
    });
  }
  
  // Sanitize inputs
  req.body.name = sanitizeString(name, 50);
  req.body.username = username.toLowerCase().trim();
  req.body.email = email.toLowerCase().trim();
  
  next();
};

export const validateSignin = (req, res, next) => {
  const { email, password } = req.body;
  
  const errors = [];
  
  const emailValidation = validateEmail(email);
  if (!emailValidation.valid) errors.push(emailValidation.message);
  
  if (!password || typeof password !== 'string' || password.length === 0) {
    errors.push("Password is required");
  }
  
  if (errors.length > 0) {
    return res.status(400).json({ 
      message: "Validation failed", 
      errors 
    });
  }
  
  req.body.email = email.toLowerCase().trim();
  next();
};

export const validateUpdateProfile = (req, res, next) => {
  const { name, bio, gender, lookingFor } = req.body;
  
  const errors = [];
  
  if (name !== undefined) {
    const nameValidation = validateName(name);
    if (!nameValidation.valid) errors.push(nameValidation.message);
  }
  
  if (bio !== undefined) {
    const bioValidation = validateBio(bio);
    if (!bioValidation.valid) errors.push(bioValidation.message);
  }
  
  if (gender !== undefined) {
    const genderValidation = validateGender(gender);
    if (!genderValidation.valid) errors.push(genderValidation.message);
  }
  
  if (lookingFor !== undefined) {
    const lookingForValidation = validateGender(lookingFor);
    if (!lookingForValidation.valid) errors.push(lookingForValidation.message);
  }
  
  if (errors.length > 0) {
    return res.status(400).json({ 
      message: "Validation failed", 
      errors 
    });
  }
  
  // Sanitize
  if (req.body.name) req.body.name = sanitizeString(req.body.name, 50);
  if (req.body.bio) req.body.bio = sanitizeString(req.body.bio, 150);
  
  next();
};

export const validateUpdatePassword = (req, res, next) => {
  const { currentPassword, newPassword } = req.body;
  
  const errors = [];
  
  if (!currentPassword || typeof currentPassword !== 'string') {
    errors.push("Current password is required");
  }
  
  const passwordValidation = validatePassword(newPassword);
  if (!passwordValidation.valid) errors.push(passwordValidation.message);
  
  if (errors.length > 0) {
    return res.status(400).json({ 
      message: "Validation failed", 
      errors 
    });
  }
  
  next();
};
