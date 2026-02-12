// Backend/utils/subscriptionRules.js

export const PLANS = {
  FREE: "free",
  GOLD: "gold",
  PLATINUM: "platinum",
  DIAMOND: "diamond", // ✅ New: Ultimate unlimited plan
};

// ---------------------------------------------
// 1. Soulmate Permissions
// ---------------------------------------------
export const getSoulmatePermissions = (plan) => {
  const normalizedPlan = plan?.toLowerCase() || PLANS.FREE;

  switch (normalizedPlan) {
    case PLANS.DIAMOND:
      return { isLocked: false, limit: Infinity }; // ✅ Unlimited Soulmates
    case PLANS.PLATINUM:
      return { isLocked: false, limit: 10 };
    case PLANS.GOLD:
      return { isLocked: false, limit: 5 };
    case PLANS.FREE:
    default:
      return { isLocked: true, limit: 0 };
  }
};

// ---------------------------------------------
// 2. Visibility Threshold
// ---------------------------------------------
export const getVisibilityThreshold = (plan) => {
  const normalizedPlan = plan?.toLowerCase() || PLANS.FREE;

  switch (normalizedPlan) {
    case PLANS.DIAMOND:
      return 100; // ✅ See ALL users regardless of match score
    case PLANS.PLATINUM:
      return 90;
    case PLANS.GOLD:
      return 80;
    case PLANS.FREE:
    default:
      return 70;
  }
};

// ---------------------------------------------
// 3. Direct Message (DM) Limits
// ---------------------------------------------
export const getDailyDmLimit = (plan) => {
  const normalizedPlan = plan?.toLowerCase() || PLANS.FREE;

  switch (normalizedPlan) {
    case PLANS.DIAMOND:
      return Infinity; // ✅ Unlimited Direct Messages
    case PLANS.PLATINUM:
      return 10;
    case PLANS.GOLD:
      return 5;
    case PLANS.FREE:
    default:
      return 0; // ✅ اصلاح شد: 0 یعنی قفل برای کاربر رایگان
  }
};

// ---------------------------------------------
// 4. Swipe Limits
// ---------------------------------------------
export const getSwipeLimit = (plan) => {
  const normalizedPlan = plan?.toLowerCase() || PLANS.FREE;
  switch (normalizedPlan) {
    case PLANS.DIAMOND:
      return Infinity; // ✅ Unlimited Swipes
    case PLANS.PLATINUM:
      return 110;
    case PLANS.GOLD:
      return 70;
    case PLANS.FREE:
    default:
      return 30;
  }
};

// ---------------------------------------------
// 5. Super Like Limits
// ---------------------------------------------
export const getSuperLikeLimit = (plan) => {
  const normalizedPlan = plan?.toLowerCase() || PLANS.FREE;
  switch (normalizedPlan) {
    case PLANS.DIAMOND:
      return Infinity; // ✅ Unlimited Super Likes
    case PLANS.PLATINUM:
      return 12;
    case PLANS.GOLD:
      return 6;
    case PLANS.FREE:
    default:
      return 2;
  }
};

// ---------------------------------------------
// 6. Blind Date Configuration
// ---------------------------------------------
export const getBlindDateConfig = (plan) => {
  const normalizedPlan = plan?.toLowerCase() || PLANS.FREE;
  switch (normalizedPlan) {
    case PLANS.DIAMOND:
      return { limit: Infinity, cooldownHours: 0 }; // ✅ Unlimited Blind Dates, No Cooldown
    case PLANS.PLATINUM:
      return { limit: 8, cooldownHours: 1 };
    case PLANS.GOLD:
      return { limit: 4, cooldownHours: 2 };
    case PLANS.FREE:
    default:
      return { limit: 2, cooldownHours: 4 };
  }
};

// ---------------------------------------------
// 7. Promo Banner Configuration
// ---------------------------------------------
export const getPromoBannerConfig = (plan) => {
  const normalizedPlan = plan?.toLowerCase() || PLANS.FREE;
  switch (normalizedPlan) {
    case PLANS.DIAMOND:
      return {
        showGold: false,
        showPlatinum: false,
        showDiamond: false,
        showBoost: false,
      }; // ✅ No promos for Diamond
    case PLANS.PLATINUM:
      return {
        showGold: false,
        showPlatinum: false,
        showDiamond: true,
        showBoost: true,
      };
    case PLANS.GOLD:
      return {
        showGold: false,
        showPlatinum: true,
        showDiamond: true,
        showBoost: true,
      };
    case PLANS.FREE:
    default:
      return {
        showGold: true,
        showPlatinum: true,
        showDiamond: true,
        showBoost: true,
      };
  }
};

// ---------------------------------------------
// 8. Match List Limits
// ---------------------------------------------
export const getMatchListLimit = (plan, type) => {
  const normalizedPlan = plan?.toLowerCase() || PLANS.FREE;

  // Mutual matches are always unlimited
  if (type === "mutual") return Infinity;

  // "Who Liked You" (Incoming Likes)
  if (type === "incoming") {
    switch (normalizedPlan) {
      case PLANS.DIAMOND:
        return Infinity;
      case PLANS.PLATINUM:
        return 20;
      case PLANS.GOLD:
        return 10;
      case PLANS.FREE:
      default:
        return 1;
    }
  }

  // Super Likes Received
  if (type === "superlikes") {
    switch (normalizedPlan) {
      case PLANS.DIAMOND:
        return Infinity;
      case PLANS.PLATINUM:
        return 10;
      case PLANS.GOLD:
        return 5;
      case PLANS.FREE:
      default:
        return 1;
    }
  }

  // Sent Likes (Users I liked)
  if (type === "sent") {
    switch (normalizedPlan) {
      case PLANS.DIAMOND:
        return Infinity;
      case PLANS.PLATINUM:
        return 90;
      case PLANS.GOLD:
        return 50;
      case PLANS.FREE:
      default:
        return 10;
    }
  }

  return 0;
};

// ---------------------------------------------
// 9. Go Date (Date Invite) Configuration
// ---------------------------------------------
export const getGoDateConfig = (plan) => {
  const normalizedPlan = plan?.toLowerCase() || PLANS.FREE;

  switch (normalizedPlan) {
    case PLANS.DIAMOND:
      return {
        limitLabel: "Unlimited",
        canCreate: true,
        period: "unlimited", // ✅ Unlimited Go Dates
      };
    case PLANS.PLATINUM:
      return {
        limitLabel: "1 per Day",
        canCreate: true,
        period: "day",
      };
    case PLANS.GOLD:
      return {
        limitLabel: "1 per Week",
        canCreate: true,
        period: "week",
      };
    case PLANS.FREE:
    default:
      return {
        limitLabel: "1 per Month",
        canCreate: true,
        period: "month",
      };
  }
};

// ---------------------------------------------
// 10. Go Date Apply Limits (per day, anti-spam)
// ---------------------------------------------
export const getGoDateApplyConfig = (plan) => {
  const normalizedPlan = plan?.toLowerCase() || PLANS.FREE;
  switch (normalizedPlan) {
    case PLANS.DIAMOND:
      return { maxPerDay: Infinity, period: "day" };
    case PLANS.PLATINUM:
      return { maxPerDay: 15, period: "day" };
    case PLANS.GOLD:
      return { maxPerDay: 8, period: "day" };
    case PLANS.FREE:
    default:
      return { maxPerDay: 3, period: "day" };
  }
};
