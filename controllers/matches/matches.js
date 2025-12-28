import User from "../../models/User.js";
import { calculateCompatibility, generateMatchInsights } from "../../utils/matchUtils.js";

export const getMatchesDashboard = async (req, res) => {
  try {
    const { type, page = 1, limit = 20 } = req.query;
    const currentUserId = req.user.userId;
    
    const user = await User.findById(currentUserId)
      .select("likedUsers likedBy interests lookingFor gender location birthday questionsbycategoriesResults")
      .lean();
      
    if (!user) return res.status(404).json({ message: "User not found" });

    const myLikedIds = (user.likedUsers || []).map(id => id.toString());
    const myLikedByIds = (user.likedBy || []).map(id => id.toString());

    if (type) {
      const pageNum = parseInt(page);
      const limitNum = parseInt(limit);
      let targetIds = [];

      if (type === 'mutual') {
        targetIds = myLikedIds.filter(id => myLikedByIds.includes(id));
      } 
      else if (type === 'incoming') {
        targetIds = myLikedByIds.filter(id => !myLikedIds.includes(id));
      } 
      else if (type === 'sent') {
        targetIds = myLikedIds.filter(id => !myLikedByIds.includes(id));
      }

      targetIds.reverse();

      const totalUsers = targetIds.length;
      const totalPages = Math.ceil(totalUsers / limitNum);
      const startIndex = (pageNum - 1) * limitNum;
      const paginatedIds = targetIds.slice(startIndex, startIndex + limitNum);

      const usersData = await User.find({ _id: { $in: paginatedIds } })
        .select("name avatar bio location birthday matchScore interests gender isVerified subscription")
        .lean();

      let processedUsers = usersData.map(matchUser => ({
        ...matchUser,
        matchScore: calculateCompatibility(user, matchUser) 
      }));

      processedUsers.sort((a, b) => {
          return paginatedIds.indexOf(a._id.toString()) - paginatedIds.indexOf(b._id.toString());
      });

      return res.status(200).json({
        users: processedUsers,
        pagination: { currentPage: pageNum, totalPages, totalUsers }
      });
    }

    else {
      let mutualIds = myLikedIds.filter(id => myLikedByIds.includes(id)).reverse();
      let sentIds = myLikedIds.filter(id => !myLikedByIds.includes(id)).reverse();
      let incomingIds = myLikedByIds.filter(id => !myLikedIds.includes(id)).reverse();

      const previewLimit = 20;
      const mutualPreviewIds = mutualIds.slice(0, previewLimit);
      const sentPreviewIds = sentIds.slice(0, previewLimit);
      const incomingPreviewIds = incomingIds.slice(0, previewLimit);

      const allPreviewIds = [...new Set([...mutualPreviewIds, ...sentPreviewIds, ...incomingPreviewIds])];

      const usersData = await User.find({ _id: { $in: allPreviewIds } })
        .select("name avatar bio location birthday matchScore interests gender isVerified subscription")
        .lean();

      const enrichUsers = (idList) => {
        return idList.map(id => {
          const matchUser = usersData.find(u => u._id.toString() === id);
          if (!matchUser) return null;
          return {
            ...matchUser,
            matchScore: calculateCompatibility(user, matchUser)
          };
        }).filter(u => u !== null);
      };

      return res.status(200).json({
        mutualMatches: enrichUsers(mutualPreviewIds),
        sentLikes: enrichUsers(sentPreviewIds),
        incomingLikes: enrichUsers(incomingPreviewIds)
      });
    }

  } catch (error) {
    console.error("Dashboard Error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

export const getMatchInsights = async (req, res) => {
  try {
    const { targetUserId } = req.params;
    const myId = req.user.userId || req.user.id;

    const me = await User.findById(myId).select("interests questionsbycategoriesResults location");
    const other = await User.findById(targetUserId).select("name avatar interests questionsbycategoriesResults location");

    if (!me || !other) {
      return res.status(404).json({ message: "User not found" });
    }

    const score = calculateCompatibility(me, other);
    const insights = generateMatchInsights(me, other);

    res.status(200).json({
      targetUser: {
        name: other.name,
        avatar: other.avatar
      },
      matchScore: score,
      ...insights
    });

  } catch (error) {
    console.error("Insights Error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};