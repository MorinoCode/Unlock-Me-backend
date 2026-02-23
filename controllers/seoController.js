import User from "../models/User.js";
import GoDate from "../models/GoDate.js";

/**
 * @desc    Generate a dynamic sitemap.xml for SEO bots
 * @route   GET /api/seo/sitemap.xml
 * @access  Public
 */
export const generateSitemap = async (req, res) => {
  try {
    const baseUrl = "https://unlock-me.app";
    
    // Core static URLs
    const staticPages = [
      "",
      "/explore",
      "/about",
      "/contact",
      "/signin",
      "/signup"
    ];

    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    xml += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;

    // 1. Add Static Pages
    const today = new Date().toISOString().split('T')[0];
    staticPages.forEach(page => {
      xml += `  <url>\n`;
      xml += `    <loc>${baseUrl}${page}</loc>\n`;
      xml += `    <lastmod>${today}</lastmod>\n`;
      xml += `    <changefreq>daily</changefreq>\n`;
      xml += `    <priority>${page === "" ? "1.0" : "0.8"}</priority>\n`;
      xml += `  </url>\n`;
    });

    // 2. Fetch Active Users (Public Profiles)
    // Only fetching essential fields to avoid memory overload for 1M+ scale
    const users = await User.find({ "privacy.profileVisibility": { $ne: "private" } })
      .select("_id updatedAt")
      .limit(10000) // Upper reasonable limit for a single sitemap
      .lean();

    users.forEach(user => {
      xml += `  <url>\n`;
      xml += `    <loc>${baseUrl}/user-profile/${user._id}</loc>\n`;
      xml += `    <lastmod>${user.updatedAt ? user.updatedAt.toISOString().split('T')[0] : today}</lastmod>\n`;
      xml += `    <changefreq>weekly</changefreq>\n`;
      xml += `    <priority>0.6</priority>\n`;
      xml += `  </url>\n`;
    });

    // 3. Fetch Active GoDates (Events)
    const activeDates = await GoDate.find({ status: "open", date: { $gt: new Date() } })
      .select("_id createdAt")
      .limit(5000)
      .lean();

    activeDates.forEach(date => {
      xml += `  <url>\n`;
      xml += `    <loc>${baseUrl}/godate/${date._id}</loc>\n`;
      xml += `    <lastmod>${date.createdAt ? date.createdAt.toISOString().split('T')[0] : today}</lastmod>\n`;
      xml += `    <changefreq>daily</changefreq>\n`;
      xml += `    <priority>0.7</priority>\n`;
      xml += `  </url>\n`;
    });

    xml += `</urlset>`;

    res.header('Content-Type', 'application/xml');
    res.send(xml);

  } catch (error) {
    console.error("Generate Sitemap Error:", error);
    res.status(500).send("Error generating sitemap");
  }
};
