export const getPasswordResetTemplate = (name, tempPassword) => {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333; border: 1px solid #e5e7eb; border-radius: 10px;">
      <div style="text-align: center; margin-bottom: 20px;">
        <h2 style="color: #6366f1; margin: 0;">UnlockMe</h2>
      </div>
      
      <h3 style="color: #1f2937;">Reset Your Password</h3>
      <p>Hi ${name},</p>
      <p>Your password has been reset successfully. Here is your temporary password:</p>
      
      <div style="background: #f3f4f6; padding: 15px; border-radius: 8px; font-size: 24px; font-weight: bold; text-align: center; margin: 25px 0; letter-spacing: 3px; color: #111827;">
        ${tempPassword}
      </div>

      <p style="color: #ef4444; font-weight: bold; background: #fee2e2; padding: 10px; border-radius: 5px; text-align: center;">
         ⚠️ ACTION REQUIRED: Log in and change this password immediately.
      </p>
      
      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">
      
      <p style="font-size: 12px; color: #9ca3af; text-align: center;">
        This email was sent from a notification-only address. Please do not reply.<br>
        &copy; ${new Date().getFullYear()} UnlockMe. All rights reserved.
      </p>
    </div>
  `;
};
