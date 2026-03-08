import User from "../../models/User.js";
import { calculateCompatibility } from "../../utils/matchUtils.js";
import { getunlockLimit } from "../../utils/subscriptionRules.js";
import { setMatchesCache } from "../../utils/cacheHelper.js";
import redisClient from "../../config/redis.js";
import { addTounlockFeedQueue } from "../../queues/unlockFeedQueue.js";
import { addTounlockActionQueue } from "../../queues/unlockActionQueue.js";

export const getunlockCards = async (req, res) => {
  try {
    const currentUserId = req.user._id || req.user.userId;
    const me = await User.findById(currentUserId);
    
    if (!me) {
        return res.status(404).json({ message: "User not found" });
    }

    const feedKey = `unlock:feed:zset:${currentUserId}`;
    let feedIds = await redisClient.zRange(feedKey, 0, 19, { REV: true }); 

    if (feedIds.length < 20) { 
      addTounlockFeedQueue(currentUserId, true).catch(() => {});
      if (feedIds.length === 0) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        feedIds = await redisClient.zRange(feedKey, 0, 19, { REV: true });
      }
    }

    if (feedIds.length === 0) {
      return res.status(200).json({ cards: [], message: "No more cards available." });
    }

    const snippetKeys = feedIds.map(id => `user:snippet:${id}`);
    const snippetsRaw = await redisClient.mGet(snippetKeys);
    
    const candidates = [];
    const missingIds = [];
    
    for (let i = 0; i < feedIds.length; i++) {
        if (snippetsRaw[i]) {
            candidates.push(JSON.parse(snippetsRaw[i]));
        } else {
            missingIds.push(feedIds[i]);
        }
    }

    if (missingIds.length > 0) {
         const dbUsers = await User.find({ _id: { $in: missingIds } })
            .select("name birthday avatar gallery bio gender location voiceIntro interests dna isVerified")
            .lean();
         
         const pipeline = redisClient.multi();
         dbUsers.forEach(u => {
             candidates.push(u);
             pipeline.setEx(`user:snippet:${u._id.toString()}`, 3600, JSON.stringify(u));
         });
         await pipeline.exec();
    }

    const orderedCandidates = feedIds
      .map(id => candidates.find(c => c._id?.toString() === id))
      .filter(Boolean);

    const unlockedSet = new Set((me.unlockedProfiles || []).map(id => id.toString()));

    const enrichedCards = orderedCandidates
      .map((user) => {
        const preCalculatedMatch = me.potentialMatches?.find(
          (m) => m.user.toString() === user._id.toString()
        );

        let compatibility = preCalculatedMatch
          ? preCalculatedMatch.matchScore
          : calculateCompatibility(me, user);

        const isManuallyUnlocked = unlockedSet.has(user._id.toString());
        const isLocked = !isManuallyUnlocked;

        const commonInterest = user.interests?.find((i) =>
          me.interests?.includes(i)
        );
        const icebreakerHint = commonInterest
          ? `I noticed we both love ${commonInterest}! Tell me, what got you into it?`
          : `Your bio caught my attention. ${
              user.bio?.substring(0, 50) || "Let's chat!"
            }`;

        return {
          _id: user._id,
          name: user.name,
          age: user.birthday?.year
            ? new Date().getFullYear() - parseInt(user.birthday.year)
            : 25,
          avatar: user.avatar,
          gallery: user.gallery || [],
          bio: user.bio,
          gender: user.gender,
          location: user.location,
          voiceIntro: user.voiceIntro || null,
          matchScore: compatibility,
          icebreaker: icebreakerHint,
          isPremiumCandidate: compatibility >= 90,
          isLocked: isLocked, 
        };
      });

    await setMatchesCache(currentUserId, "unlock", enrichedCards, 180);

    res.status(200).json(enrichedCards);
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};

export const handleunlockAction = async (req, res) => {
  try {
    const currentUserId = req.user._id || req.user.userId;
    const { targetUserId, action } = req.body;

    if (!targetUserId || !action) {
      return res.status(400).json({ message: "Invalid data." });
    }

    const rateLimitKey = `rate:swipe:${currentUserId}:${Math.floor(Date.now() / 1000)}`;
    const pipeline = redisClient.multi();
    pipeline.incr(rateLimitKey);
    pipeline.expire(rateLimitKey, 2);
    const results = await pipeline.exec();
    const swipes = Array.isArray(results[0]) ? results[0][1] : results[0]; 
    if (swipes > 5) {
        return res.status(429).json({ message: "Too many requests" });
    }

    const currentUserData = await User.findById(currentUserId)
            .select("subscription usage likedUsers dislikedUsers superLikedUsers")
            .lean(); 

    if (!currentUserData) return res.status(404).json({ message: "User not found" });

    const alreadyInteract = 
        currentUserData.likedUsers?.some(id => id.toString() === targetUserId) ||
        currentUserData.dislikedUsers?.some(id => id.toString() === targetUserId) ||
        currentUserData.superLikedUsers?.some(id => id.toString() === targetUserId);
    
    if (alreadyInteract && action !== 'skip') {
         return res.status(400).json({ message: "Already unlocked" });
    }

    const userPlan = currentUserData.subscription?.plan || "free";
    const unlockLimit = getunlockLimit(userPlan);
    
    const unlocksToday = currentUserData.usage?.unlocksCount || 0;
    
    if (action === 'right' || action === 'left') {
        if (unlockLimit !== Infinity && unlocksToday >= unlockLimit) {
             return res.status(403).json({ error: "Limit Reached", message: "Daily limit reached" });
        }
    }

    let isMatch = false;
    let matchDetails = null;

    if (action === 'right' || action === 'up') {
        const targetUser = await User.findById(targetUserId)
            .select("likedUsers superLikedUsers name avatar")
            .lean();

        if (targetUser) {
             isMatch = (targetUser.likedUsers || []).some(id => id.toString() === currentUserId.toString()) ||
                       (targetUser.superLikedUsers || []).some(id => id.toString() === currentUserId.toString());
             
             if (isMatch) {
                 matchDetails = {
                     name: targetUser.name,
                     avatar: targetUser.avatar,
                     id: targetUser._id
                 };
             }
        }
    }

    await addTounlockActionQueue({
        userId: currentUserId,
        targetUserId,
        action,
        isMatch 
    });

    try {
      const feedKey = `unlock:feed:zset:${currentUserId}`;
      const historyKey = `unlock:history:${currentUserId}`;
      await redisClient.zRem(feedKey, targetUserId.toString()); 
      await redisClient.sAdd(historyKey, targetUserId.toString());
      await redisClient.expire(historyKey, 7 * 24 * 60 * 60);

      const len = await redisClient.zCard(feedKey); 
      if (len < 20) {
           addTounlockFeedQueue(currentUserId, false).catch(() => {});
      }
    } catch (e) {
    }

    res.status(200).json({
      success: true,
      isMatch,
      matchDetails,
      updatedUsage: {
          unlocksCount: unlocksToday + 1
      }
    });

  } catch (error) {
    res.status(500).json({ message: "Server Error" });
  }
};
