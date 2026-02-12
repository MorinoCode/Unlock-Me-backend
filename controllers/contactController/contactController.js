import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

/**
 * @desc    Submit contact form
 * @route   POST /api/contact
 * @access  Public
 */
export const submitContactForm = async (req, res) => {
  try {
    const { name, email, subject, message } = req.body;

    if (!name || !email || !subject || !message) {
      return res.status(400).json({ message: "All fields are required" });
    }

    // Email content for the support team
    const emailHtml = `
      <div style="font-family: sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 10px; overflow: hidden;">
        <div style="padding: 20px; background-color: #f9f9f9; border-bottom: 5px solid #8e44ad;">
          <h2 style="margin: 0; color: #8e44ad;">New Contact Form Submission</h2>
        </div>
        <div style="padding: 20px;">
          <p><strong>Name:</strong> ${name}</p>
          <p><strong>Email:</strong> ${email}</p>
          <p><strong>Subject:</strong> ${subject}</p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
          <p><strong>Message:</strong></p>
          <p style="white-space: pre-wrap; padding: 15px; background: #fffaf0; border-radius: 5px; border-left: 4px solid #f39c12;">${message}</p>
        </div>
        <div style="padding: 15px; text-align: center; background-color: #f9f9f9; font-size: 12px; color: #777;">
          Sent from Unlock-Me Contact Form
        </div>
      </div>
    `;

    const { error } = await resend.emails.send({
      from: "Unlock-Me Support <noreply@unlock-me.app>",
      to: ["support@unlock-me.app"], // Recipient address as discussed
      subject: `[Contact Form] ${subject}`,
      html: emailHtml,
      reply_to: email, // Set user email as reply-to for easy follow-up
    });

    if (error) {
      console.error("Resend Error (Contact Form):", error);
      return res.status(500).json({ message: "Failed to send email. Please try again later." });
    }

    res.status(200).json({
      success: true,
      message: "Your message has been received. We'll get back to you soon.",
    });

  } catch (error) {
    console.error("Submit Contact Form Error:", error);
    const errorMessage = process.env.NODE_ENV === 'production' 
      ? "Server error. Please try again later." 
      : error.message;
    res.status(500).json({ message: errorMessage });
  }
};
