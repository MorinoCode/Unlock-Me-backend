/**
 * ✅ Critical Fix: Environment Variables Validation
 * Validates required and optional environment variables before server starts
 */

const requiredEnvVars = [
  'MONGO_URI',
  'JWT_SECRET',
  'PORT'
];

const optionalEnvVars = [
  'REDIS_URL',
  'CLOUDINARY_NAME',
  'CLOUDINARY_KEY',
  'CLOUDINARY_SECRET',
  'RESEND_API_KEY',
  'STRIPE_SECRET_KEY',
];

export const validateEnv = () => {
  const missing = [];
  
  requiredEnvVars.forEach(varName => {
    if (!process.env[varName]) {
      missing.push(varName);
    }
  });
  
  if (missing.length > 0) {
    console.error(`❌ Missing required environment variables: ${missing.join(', ')}`);
    console.error('❌ Server cannot start without these variables.');
    process.exit(1);
  }
  
  // Warn about optional vars
  const missingOptional = [];
  optionalEnvVars.forEach(varName => {
    if (!process.env[varName]) {
      missingOptional.push(varName);
    }
  });
  
  if (missingOptional.length > 0) {
    console.warn(`⚠️ Optional environment variables missing: ${missingOptional.join(', ')}`);
    console.warn('⚠️ Some features may not work correctly.');
  }
  
  console.log('✅ Environment variables validated');
};
