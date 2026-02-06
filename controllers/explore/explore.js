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
// ✅ Performance Fix: Import cache helpers
import { getMatchesCache, setMatchesCache } from "../../utils/cacheHelper.js";
import {
  getCompatibilityScore,
  setCompatibilityScore,
  getFromPotentialPoolPaginated,
} from "../../utils/redisMatchHelper.js";

export const getUserLocation = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select("location");
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json(user);
  } catch (err) {
    console.error("Get User Location Error:", err);
    const errorMessage = process.env.NODE_ENV === 'production' 
      ? "Server error. Please try again later." 
      : err.message;
    res.status(500).json({ message: errorMessage });
  }
};

export const getExploreMatches = async (req, res) => {
  try {
    const { category, page = 1, limit = 10 } = req.query; 
    const currentUserId = req.user.userId;
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(20, Math.max(1, parseInt(limit))); // Limit max items to 20 for safety

    // ✅ Performance Fix: Try cache first
    const cacheKey = category || 'overview';
    const cached = await getMatchesCache(currentUserId, `explore_${cacheKey}_${pageNum}`);
    if (cached) {
      return res.status(200).json(cached);
    }

    const me = await User.findById(currentUserId).select(
      "location interests lookingFor subscription potentialMatches gender birthday dna likedUsers dislikedUsers superLikedUsers"
    );

    if (!me) return res.status(404).json({ message: "User not found" });

    const userPlan = me.subscription?.plan || "free";
    const visibilityLimit = getVisibilityThreshold(userPlan);
    const soulmatePerms = getSoulmatePermissions(userPlan);
    
    // ✅ Performance Fix: Cache populated matches to avoid double populate
    let populatedMatches = null;
    
    // --- Helper: Process Users (parallel Redis get + parallel compute for missing) ---
    const processUsersList = async (usersList) => {
        if (!usersList.length) return [];
        const currentId = currentUserId.toString();
        const list = usersList.map((u) => (u.toObject ? u.toObject() : { ...u }));

        // Batch: get all scores (use existing or Redis) in parallel
        const scorePromises = list.map((userObj) => {
            const existing = typeof userObj.matchScore === "number" ? userObj.matchScore : null;
            if (existing !== null) return Promise.resolve(existing);
            const targetId = userObj._id?.toString?.() || userObj._id;
            return getCompatibilityScore(currentId, targetId);
        });
        const scoresFromRedis = await Promise.all(scorePromises);

        // For any still missing, compute and set in parallel
        const toCompute = list
            .map((userObj, listIndex) => ({
                userObj,
                listIndex,
                score: scoresFromRedis[listIndex],
            }))
            .filter(({ score }) => score === null || score === undefined);

        if (toCompute.length > 0) {
            const computed = await Promise.all(
                toCompute.map(async ({ userObj, listIndex }) => {
                    const s = calculateCompatibility(me, userObj);
                    const targetId = userObj._id?.toString?.() || userObj._id;
                    setCompatibilityScore(currentId, targetId, s).catch(() => {});
                    return { listIndex, score: s };
                })
            );
            computed.forEach(({ listIndex, score }) => {
                scoresFromRedis[listIndex] = score;
            });
        }

        const finalScores = list.map((_, i) =>
            typeof list[i].matchScore === "number" ? list[i].matchScore : (scoresFromRedis[i] ?? 50)
        );

        return list.map((userObj, i) => {
            const score = finalScores[i];
            const isLocked = score > visibilityLimit;
            return {
                _id: userObj._id,
                name: userObj.name,
                avatar: userObj.avatar,
                birthday: userObj.birthday,
                location: userObj.location,
                matchScore: score,
                isVerified: userObj.isVerified,
                isLocked,
                dna: isLocked ? null : calculateUserDNA(userObj),
                bio: userObj.bio,
                interests: userObj.interests,
            };
        });
    };

    // --- MODE 1: Cached Lists (Soulmates, Interests) ---
    if (category === "soulmates" || category === "interests") {
      
      if (category === "soulmates" && soulmatePerms.isLocked) {
        return res.status(403).json({ message: "Upgrade required to view Soulmates." });
      }

      // ✅ Performance Fix: Populate once and reuse
      if (!populatedMatches) {
        await me.populate({
          path: "potentialMatches.user",
          select: "name avatar bio interests location birthday subscription gender createdAt isVerified dna",
        });
        populatedMatches = me.potentialMatches;
      }

      let cachedUsers = populatedMatches
        .filter((m) => m.user) // Filter out deleted users
        .map((m) => ({ ...m.user.toObject(), matchScore: m.matchScore }));

      if (category === "soulmates") {
        cachedUsers = cachedUsers.filter((u) => u.matchScore >= 80);
      } else if (category === "interests") {
        cachedUsers = cachedUsers.filter((u) =>
          u.interests.some((i) => me.interests.includes(i))
        );
      }

      cachedUsers.sort((a, b) => b.matchScore - a.matchScore);

      // Pagination in memory
      const totalUsers = cachedUsers.length;
      const totalPages = Math.ceil(totalUsers / limitNum);
      const startIndex = (pageNum - 1) * limitNum;
      const slicedUsers = cachedUsers.slice(startIndex, startIndex + limitNum);

      const finalUsers = await processUsersList(slicedUsers);

      const result = {
        mode: "cached_list",
        userPlan,
        users: finalUsers,
        pagination: { currentPage: pageNum, totalPages, totalUsers },
      };
      
      // ✅ Performance Fix: Cache the result
      await setMatchesCache(currentUserId, `explore_${cacheKey}_${pageNum}`, result, 300); // 5 minutes
      
      return res.status(200).json(result);
    }

    // --- MODE 2: Redis pool (new/country) or Live DB (nearby) ---
    else if (["new", "nearby", "country"].includes(category)) {
      const excludeIds = [
        currentUserId?.toString?.() || currentUserId,
        ...(me.likedUsers || []).map((id) => id.toString()),
        ...(me.dislikedUsers || []).map((id) => id.toString()),
        ...(me.superLikedUsers || []).map((id) => id.toString()),
      ];

      let finalUsers;
      let totalUsers;
      let totalPages;
      const POOL_MAX_ESTIMATE = 500;

      // ✅ Use Redis pool for "new" and "country" (same country, score-ranked)
      if ((category === "new" || category === "country") && me.location?.country) {
        const offset = (pageNum - 1) * limitNum;
        const poolCandidates = await getFromPotentialPoolPaginated(
          currentUserId,
          limitNum,
          excludeIds,
          offset
        );

        if (poolCandidates.length > 0) {
          const userIds = poolCandidates.map((c) => c.userId);
          const userDocs = await User.find({ _id: { $in: userIds } })
            .select("name avatar bio interests location birthday subscription gender createdAt isVerified dna")
            .lean();
          const byId = new Map(userDocs.map((u) => [u._id.toString(), u]));
          const candidatesWithScore = poolCandidates.map((c) => {
            const doc = byId.get(c.userId);
            return doc ? { ...doc, matchScore: c.score } : null;
          }).filter(Boolean);
          finalUsers = await processUsersList(candidatesWithScore);
          if (category === "new") {
            finalUsers.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
          } else {
            finalUsers.sort((a, b) => b.matchScore - a.matchScore);
          }
          totalUsers = POOL_MAX_ESTIMATE;
          totalPages = Math.ceil(POOL_MAX_ESTIMATE / limitNum);
        }
      }

      // Fallback to DB: nearby (city filter) or when pool empty
      if (!finalUsers) {
        let dbQuery = {
          _id: { $nin: excludeIds },
          "location.country": me.location?.country || "",
        };
        if (me.lookingFor) dbQuery.gender = me.lookingFor;
        if (category === "nearby" && me.location?.city) {
          dbQuery["location.city"] = {
            $regex: new RegExp(`^${escapeRegex(me.location.city)}$`, "i"),
          };
        }
        const sortOption = { createdAt: -1 };
        totalUsers = await User.countDocuments(dbQuery);
        totalPages = Math.ceil(totalUsers / limitNum);
        const candidates = await User.find(dbQuery)
          .select("name avatar bio interests location birthday subscription gender createdAt isVerified dna")
          .sort(sortOption)
          .skip((pageNum - 1) * limitNum)
          .limit(limitNum)
          .lean();
        finalUsers = await processUsersList(candidates);
        if (category !== "new") {
          finalUsers.sort((a, b) => b.matchScore - a.matchScore);
        }
      }

      const result = {
        mode: "live_list",
        userPlan,
        users: finalUsers,
        pagination: { currentPage: pageNum, totalPages, totalUsers: totalUsers ?? 0 },
      };
      await setMatchesCache(currentUserId, `explore_${cacheKey}_${pageNum}`, result, 300);
      return res.status(200).json(result);
    }

    // --- MODE 3: Dashboard Overview ---
    else {
      // ✅ Performance Fix: Reuse populated matches if already populated
      if (!populatedMatches) {
        await me.populate({
          path: "potentialMatches.user",
          select: "name avatar bio interests location birthday subscription gender createdAt isVerified dna",
        });
        populatedMatches = me.potentialMatches;
      }

      let allMatches = populatedMatches
        .filter((m) => m.user)
        .map((m) => {
          const userObj = m.user.toObject();
          const finalScore = (m.matchScore > 0) ? m.matchScore : calculateCompatibility(me, userObj);
          return { ...userObj, matchScore: finalScore };
        });

      // Fallback if cache is empty
      if (allMatches.length < 5) {
        const fallbackUsers = await User.find({
          _id: { $ne: currentUserId },
          "location.country": me.location.country,
        })
          .limit(20)
          .select("name avatar bio interests location birthday subscription gender isVerified dna")
          .lean();
        
        const freshMatches = fallbackUsers.map((u) => ({
          ...u,
          matchScore: calculateCompatibility(me, u),
        }));
        
        allMatches = [...allMatches, ...freshMatches];
      }

      // Grouping
      const soulmatePool = allMatches.filter((u) => u.matchScore >= 80).sort((a, b) => b.matchScore - a.matchScore);
      const generalPool = allMatches;

      // Apply Limits
      let finalSoulmates = [];
      if (!soulmatePerms.isLocked) {
        finalSoulmates = soulmatePerms.limit === Infinity
            ? shuffleArray([...soulmatePool]).slice(0, 10)
            : soulmatePool.slice(0, soulmatePerms.limit);
      }

      // Fetch nearby users separately (same logic as category=nearby)
      let nearbyUsers = [];
      if (me.location?.city) {
        const nearbyQuery = {
          _id: { $ne: currentUserId },
          "location.country": me.location.country,
          "location.city": {
            $regex: new RegExp(`^${escapeRegex(me.location.city)}$`, "i"),
          },
        };
        
        if (me.lookingFor) {
          nearbyQuery.gender = me.lookingFor;
        }
        
        const nearbyCandidates = await User.find(nearbyQuery)
          .select("name avatar bio interests location birthday subscription gender createdAt isVerified dna")
          .limit(20)
          .lean();
        
        nearbyUsers = nearbyCandidates.map((u) => ({
          ...u,
          matchScore: calculateCompatibility(me, u),
        }));
        nearbyUsers.sort((a, b) => b.matchScore - a.matchScore);
      }

      const [
        soulmatesList,
        freshFacesList,
        cityMatchesList,
        interestMatchesList,
        countryMatchesList,
      ] = await Promise.all([
        processUsersList(finalSoulmates),
        processUsersList(shuffleArray([...generalPool]).slice(0, 10)),
        processUsersList(nearbyUsers.slice(0, 20)),
        processUsersList(
          shuffleArray(
            generalPool.filter((u) =>
              u.interests.some((i) => me.interests.includes(i))
            )
          ).slice(0, 10)
        ),
        processUsersList(shuffleArray([...generalPool]).slice(0, 10)),
      ]);
      const sections = {
        soulmates: soulmatesList,
        freshFaces: freshFacesList,
        cityMatches: cityMatchesList,
        interestMatches: interestMatchesList,
        countryMatches: countryMatchesList,
      };

      const result = {
        userPlan,
        mode: "overview",
        sections,
      };
      
      // ✅ Performance Fix: Cache the result
      await setMatchesCache(currentUserId, `explore_${cacheKey}_${pageNum}`, result, 300); // 5 minutes
      
      return res.status(200).json(result);
    }
  } catch (err) {
    console.error("Explore Error:", err);
    // ✅ Security Fix: Don't expose error details
    const errorMessage = process.env.NODE_ENV === 'production' 
      ? "Server error. Please try again later." 
      : err.message;
    res.status(500).json({ message: errorMessage });
  }
};

export const getUserDetails = async (req, res) => {
  try {
    const { userId } = req.params;
    const currentUserId = req.user.userId;

    // ✅ Performance Fix: Try cache first
    const cacheKey = `user_details_${userId}`;
    const cached = await getMatchesCache(currentUserId, cacheKey);
    if (cached) {
      return res.status(200).json(cached);
    }

    const targetUser = await User.findById(userId).select("-password");
    if (!targetUser) return res.status(404).json({ message: "User not found" });

    const me = await User.findById(currentUserId).select(
      "potentialMatches interests location dna lookingFor subscription gender birthday"
    );

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
    
    // Only calculate expensive insights if not locked
    const dna = calculateUserDNA(targetUser);
    const insights = isLocked ? null : generateMatchInsights(me, targetUser);

    const result = {
      ...targetUser.toObject(),
      matchScore: score,
      dna: dna,
      insights: insights,
      isLocked: isLocked, 
    };
    
    // ✅ Performance Fix: Cache the result
    await setMatchesCache(currentUserId, `user_details_${userId}`, result, 300); // 5 minutes
    
    res.status(200).json(result);
  } catch (err) {
    console.error("User Details Error:", err);
    // ✅ Security Fix: Don't expose error details
    const errorMessage = process.env.NODE_ENV === 'production' 
      ? "Server error. Please try again later." 
      : err.message;
    res.status(500).json({ message: errorMessage });
  }
};