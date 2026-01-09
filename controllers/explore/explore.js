// backend/controllers/exploreController.js

import User from "../../models/User.js";
import {
  calculateCompatibility,
  calculateUserDNA,
  shuffleArray,
  generateMatchInsights,
  getVisibilityThreshold,
  getSoulmatePermissions,
  escapeRegex,
} from "../../utils/matchUtils.js";

export const getUserLocation = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select("location");
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: "Server error", err });
  }
};

export const getExploreMatches = async (req, res) => {
  try {
    const { category, page = 1, limit = 10 } = req.query; // Default limit 10 for performance
    const currentUserId = req.user.userId;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);

    // Get current user data
    const me = await User.findById(currentUserId).select(
      "location interests lookingFor subscription potentialMatches"
    );

    if (!me) return res.status(404).json({ message: "User not found" });

    const userPlan = me.subscription?.plan || "free";

    // ✅ Use helper functions from matchUtils
    const visibilityLimit = getVisibilityThreshold(userPlan);
    const soulmatePerms = getSoulmatePermissions(userPlan);
    
    // Helper to process a list of users (Shared logic for all modes)
    const processUsersList = (usersList) => {
        return usersList.map((user) => {
            // 1. Calculate Score (if missing)
            let score = user.matchScore;
            
            // Handle if user is a mongoose document or plain object
            const userObj = user.toObject ? user.toObject() : user;

            if (!score && score !== 0) {
                 score = calculateCompatibility(me, userObj); 
            }

            // 2. ✅ Server-Side Locking Logic
            // If user's score (e.g. 95) is higher than my plan's visibility limit (e.g. 80) -> Lock it
            const isLocked = score > visibilityLimit;

            return {
                _id: userObj._id,
                name: userObj.name,
                avatar: userObj.avatar,
                birthday: userObj.birthday,
                location: userObj.location,
                matchScore: score,
                isVerified: userObj.isVerified,
                // ✅ Key Field for Frontend
                isLocked: isLocked, 
                // Optimize: Don't send heavy DNA if locked
                dna: isLocked ? null : calculateUserDNA(userObj), 
                // Pass basic info needed for card
                bio: userObj.bio,
                interests: userObj.interests,
            };
        });
    };

    // =========================================================
    // 🔵 MODE 1: Cached Strategy (Soulmates, Interests)
    // =========================================================
    if (category === "soulmates" || category === "interests") {
      
      // Check Soulmate Permissions
      if (category === "soulmates" && soulmatePerms.isLocked) {
        return res.status(403).json({ message: "Upgrade required to view Soulmates." });
      }

      await me.populate({
        path: "potentialMatches.user",
        select: "name avatar bio interests location birthday subscription gender createdAt isVerified dna",
      });

      let cachedUsers = me.potentialMatches
        .filter((m) => m.user)
        .map((m) => ({ ...m.user.toObject(), matchScore: m.matchScore }));

      if (category === "soulmates") {
        cachedUsers = cachedUsers.filter((u) => u.matchScore >= 80);
      } else if (category === "interests") {
        cachedUsers = cachedUsers.filter((u) =>
          u.interests.some((i) => me.interests.includes(i))
        );
      }

      cachedUsers.sort((a, b) => b.matchScore - a.matchScore);

      // Pagination
      const totalUsers = cachedUsers.length;
      const totalPages = Math.ceil(totalUsers / limitNum);
      const startIndex = (pageNum - 1) * limitNum;
      const slicedUsers = cachedUsers.slice(startIndex, startIndex + limitNum);

      // Process (Add isLocked)
      const finalUsers = processUsersList(slicedUsers);

      return res.status(200).json({
        mode: "cached_list",
        userPlan,
        users: finalUsers,
        pagination: { currentPage: pageNum, totalPages, totalUsers },
      });
    }

    // =========================================================
    // 🟢 MODE 2: Live DB Strategy (New, Nearby, Country)
    // =========================================================
    else if (
      category === "new" ||
      category === "nearby" ||
      category === "country"
    ) {
      let dbQuery = {
        _id: { $ne: currentUserId },
        "location.country": me.location.country,
      };

      if (me.lookingFor && me.lookingFor !== "all") {
        dbQuery.gender = { $regex: new RegExp(`^${me.lookingFor}$`, "i") };
      }

      if (category === "nearby") {
        if (me.location?.city) {
          dbQuery["location.city"] = {
            $regex: new RegExp(`^${escapeRegex(me.location.city)}$`, "i"),
          };
        }
      }

      let sortOption = { createdAt: -1 };
      if (category === "country") sortOption = { createdAt: -1 };

      const totalUsers = await User.countDocuments(dbQuery);
      const totalPages = Math.ceil(totalUsers / limitNum);

      const candidates = await User.find(dbQuery)
        .select("name avatar bio interests location birthday subscription gender createdAt isVerified dna")
        .sort(sortOption)
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .lean();

      // Process (Calculate Score + Add isLocked)
      const finalUsers = processUsersList(candidates);

      // For non-new categories, sort by match score (descending)
      if (category !== "new") {
        finalUsers.sort((a, b) => b.matchScore - a.matchScore);
      }

      return res.status(200).json({
        mode: "live_list",
        userPlan,
        users: finalUsers,
        pagination: { currentPage: pageNum, totalPages, totalUsers },
      });
    }

    // =========================================================
    // 🟡 MODE 3: Overview / Dashboard (Initial Load)
    // =========================================================
    else {
      await me.populate({
        path: "potentialMatches.user",
        select: "name avatar bio interests location birthday subscription gender createdAt isVerified dna",
      });

      let allMatches = me.potentialMatches
        .filter((m) => m.user)
        .map((m) => {
          const userObj = m.user.toObject();
          // Smart Logic: Recalculate if score is 0 or missing
          const finalScore = (m.matchScore && m.matchScore > 0)
              ? m.matchScore
              : calculateCompatibility(me, userObj);

          return { ...userObj, matchScore: finalScore };
        });

      // Fallback for new users
      if (allMatches.length === 0) {
        const fallbackUsers = await User.find({
          _id: { $ne: currentUserId },
          "location.country": me.location.country,
        })
          .limit(20)
          .lean();
        
        allMatches = fallbackUsers.map((u) => ({
          ...u,
          matchScore: calculateCompatibility(me, u),
        }));
      }

      // 1. Soulmate Pool
      const soulmatePool = allMatches
        .filter((u) => u.matchScore >= 80)
        .sort((a, b) => b.matchScore - a.matchScore);

      // 2. General Pool
      const generalPool = allMatches;

      // 3. Apply Soulmate Limits
      let finalSoulmates = [];
      if (!soulmatePerms.isLocked) {
        finalSoulmates = soulmatePerms.limit === Infinity
            ? shuffleArray([...soulmatePool]).slice(0, 10)
            : soulmatePool.slice(0, soulmatePerms.limit);
      }

      // 4. Construct Sections with isLocked logic
      const sections = {
        soulmates: processUsersList(finalSoulmates),
        freshFaces: processUsersList(shuffleArray([...generalPool]).slice(0, 10)),
        cityMatches: processUsersList(
            shuffleArray(
                generalPool.filter((u) => u.location?.city === me.location?.city)
            ).slice(0, 10)
        ),
        interestMatches: processUsersList(
            shuffleArray(
                generalPool.filter((u) =>
                    u.interests.some((i) => me.interests.includes(i))
                )
            ).slice(0, 10)
        ),
        countryMatches: processUsersList(shuffleArray([...generalPool]).slice(0, 10)),
      };

      return res.status(200).json({
        userPlan,
        mode: "overview",
        sections,
      });
    }
  } catch (err) {
    console.error("Explore Error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

// --- Get User Details (Single Profile) ---
export const getUserDetails = async (req, res) => {
  try {
    const { userId } = req.params;
    const currentUserId = req.user.userId;

    const targetUser = await User.findById(userId).select("-password");
    if (!targetUser) return res.status(404).json({ message: "User not found" });

    const me = await User.findById(currentUserId).select(
      "potentialMatches interests location dna lookingFor subscription"
    );

    // ✅ Check Lock status for single user view
    const userPlan = me.subscription?.plan || "free";
    const visibilityLimit = getVisibilityThreshold(userPlan);

    const cachedMatch = me.potentialMatches?.find(
      (m) => m.user.toString() === targetUser._id.toString()
    );

    let score;
    if (cachedMatch && cachedMatch.matchScore > 0) {
      score = cachedMatch.matchScore;
    } else {
      score = calculateCompatibility(me, targetUser);
    }

    const isLocked = score > visibilityLimit;

    const dna = calculateUserDNA(targetUser);
    const insights = generateMatchInsights(me, targetUser);

    res.status(200).json({
      ...targetUser.toObject(),
      matchScore: score,
      dna: dna,
      insights: insights,
      isLocked: isLocked, 
    });
  } catch (err) {
    console.error("User Details Error:", err);
    res.status(500).json({ message: "Server error", err });
  }
};