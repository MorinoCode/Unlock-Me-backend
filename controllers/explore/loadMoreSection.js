// ✅ Load More Section (Pagination)
export const loadMoreSection = async (req, res) => {
  try {
    const { section, page, limit } = req.body;
    const userId = req.user.userId;
    const userPlan = req.user.subscription?.plan || "free";

    // Import pagination workers
    const {
      loadMoreNearYou,
      loadMoreFreshFaces,
      loadMoreAcrossCountry,
      loadMoreCompatibilityVibes,
      loadMoreSoulmates
    } = await import("../../workers/explorePaginationWorkers.js");

    let result;

    switch (section) {
      case "nearYou":
      case "nearby":
      case "city":
        result = await loadMoreNearYou(userId, page, limit);
        break;

      case "freshFaces":
      case "fresh":
      case "new":
        result = await loadMoreFreshFaces(userId, page, limit);
        break;

      case "acrossTheCountry":
      case "country":
        result = await loadMoreAcrossCountry(userId, page, limit);
        break;

      case "compatibilityVibes":
      case "interests":
      case "compatibility":
        result = await loadMoreCompatibilityVibes(userId, page, limit);
        break;

      case "soulmates":
        result = await loadMoreSoulmates(userId, page, limit, userPlan);
        break;

      default:
        return res.status(400).json({ error: "Invalid section" });
    }

    res.status(200).json(result);
  } catch (error) {
    console.error("[loadMoreSection] Error:", error);
    
    // Handle premium lock error
    if (error.message.includes("Premium subscription required")) {
      return res.status(403).json({ 
        error: error.message,
        requiresPremium: true 
      });
    }

    res.status(500).json({ error: error.message });
  }
};
