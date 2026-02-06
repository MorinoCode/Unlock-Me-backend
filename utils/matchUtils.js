// backend/utils/matchUtils.js

// ==========================================
// 1. Helper Function: Regex Escaping
// ==========================================
export const escapeRegex = (text) => {
  if (!text) return "";
  return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
};

// ==========================================
// 2. Constants & Subscription Rules
// ==========================================
export const PLANS = {
  FREE: "free",
  GOLD: "gold",
  PLATINUM: "platinum",
  DIAMOND: "diamond", // ✅ New: Ultimate unlimited plan
};

// Helper to normalize plan string
const normalizePlan = (plan) => {
  const p = plan?.toLowerCase() || PLANS.FREE;
  if (p.includes("diamond")) return PLANS.DIAMOND; // ✅ Check Diamond first
  if (p.includes("platinum") || p.includes("premium")) return PLANS.PLATINUM;
  if (p.includes("gold")) return PLANS.GOLD;
  return PLANS.FREE;
};

// --- VISIBILITY LIMITS ---
// ✅ Sync with subscriptionRules.js
export const getVisibilityThreshold = (plan) => {
  const p = normalizePlan(plan);
  switch (p) {
    case PLANS.DIAMOND:
      return 100; // ✅ See ALL users regardless of match score
    case PLANS.PLATINUM:
      return 90;
    case PLANS.GOLD:
      return 80;
    default:
      return 70; // FREE
  }
};

// --- SOULMATE PERMISSIONS ---
// ✅ Sync with subscriptionRules.js
export const getSoulmatePermissions = (plan) => {
  const p = normalizePlan(plan);
  switch (p) {
    case PLANS.DIAMOND:
      return { isLocked: false, limit: Infinity }; // ✅ Unlimited Soulmates
    case PLANS.PLATINUM:
      return { isLocked: false, limit: 10 };
    case PLANS.GOLD:
      return { isLocked: false, limit: 5 };
    default:
      return { isLocked: true, limit: 0 }; // FREE
  }
};

// --- SWIPE LIMITS ---
// ✅ Sync with subscriptionRules.js
export const getSwipeLimit = (plan) => {
  const p = normalizePlan(plan);
  switch (p) {
    case PLANS.DIAMOND:
      return Infinity; // ✅ Unlimited Swipes
    case PLANS.PLATINUM:
      return 110;
    case PLANS.GOLD:
      return 70;
    default:
      return 30; // FREE
  }
};

// --- SUPER LIKE LIMITS ---
// ✅ Sync with subscriptionRules.js
export const getSuperLikeLimit = (plan) => {
  const p = normalizePlan(plan);
  switch (p) {
    case PLANS.DIAMOND:
      return Infinity; // ✅ Unlimited Super Likes
    case PLANS.PLATINUM:
      return 12;
    case PLANS.GOLD:
      return 6;
    default:
      return 2; // FREE
  }
};

// --- DM LIMITS ---
export const getDailyDmLimit = (plan) => {
  const p = normalizePlan(plan);
  switch (p) {
    case PLANS.DIAMOND:
      return Infinity; // ✅ Unlimited Direct Messages
    case PLANS.PLATINUM:
      return 10;
    case PLANS.GOLD:
      return 5;
    default:
      return 0;
  }
};

// --- BLIND DATE CONFIG ---
// ✅ Sync with subscriptionRules.js
export const getBlindDateConfig = (plan) => {
  const p = normalizePlan(plan);
  switch (p) {
    case PLANS.DIAMOND:
      return { limit: Infinity, cooldownHours: 0 }; // ✅ Unlimited Blind Dates, No Cooldown
    case PLANS.PLATINUM:
      return { limit: 8, cooldownHours: 1 };
    case PLANS.GOLD:
      return { limit: 4, cooldownHours: 2 };
    default:
      return { limit: 2, cooldownHours: 4 }; // FREE
  }
};

// --- MATCH LIST LIMITS ---
// ✅ Sync with subscriptionRules.js
export const getMatchListLimit = (plan, type) => {
  const p = normalizePlan(plan);

  if (type === "mutual") return Infinity;

  if (type === "incoming") {
    // Who liked you
    switch (p) {
      case PLANS.DIAMOND:
      case PLANS.PLATINUM:
      case PLANS.GOLD:
        return Infinity;
      default:
        return 0; // Locked for free users
    }
  }

  if (type === "sent") {
    // Who you liked
    switch (p) {
      case PLANS.DIAMOND:
        return Infinity;
      case PLANS.PLATINUM:
        return 90;
      case PLANS.GOLD:
        return 50;
      default:
        return 10; // FREE
    }
  }
  return 0;
};

// --- PROMO BANNERS ---
export const getPromoBannerConfig = (plan) => {
  const p = normalizePlan(plan);
  switch (p) {
    case PLANS.PLATINUM:
      return { showGold: false, showPlatinum: false, showBoost: true };
    case PLANS.GOLD:
      return { showGold: false, showPlatinum: true, showBoost: true };
    default:
      return { showGold: true, showPlatinum: true, showBoost: true };
  }
};

// ==========================================
// 3. Data Mappings (Traits)
// ==========================================
const TRAIT_MAPPING = {
  Solver: "Logic",
  Analytical: "Logic",
  Rational: "Logic",
  Thinker: "Logic",
  Scientific: "Logic",
  Pragmatist: "Logic",
  Optimizer: "Logic",
  Determinist: "Logic",
  Technical: "Logic",
  Objective: "Logic",
  Critical: "Logic",
  Feeler: "Emotion",
  Empathetic: "Emotion",
  Sensitive: "Emotion",
  Romantic: "Emotion",
  Nurturing: "Emotion",
  Humanist: "Emotion",
  Peacekeeper: "Emotion",
  Emotional: "Emotion",
  Sentimental: "Emotion",
  Kind: "Emotion",
  Compassionate: "Emotion",
  Active: "Energy",
  Energetic: "Energy",
  Extrovert: "Energy",
  Social: "Energy",
  Adventurous: "Energy",
  "Risk Taker": "Energy",
  Spontaneous: "Energy",
  Playful: "Energy",
  Leader: "Energy",
  Outgoing: "Energy",
  Creator: "Creativity",
  Artist: "Creativity",
  Creative: "Creativity",
  Visual: "Creativity",
  Storyteller: "Creativity",
  Abstract: "Creativity",
  Dreamer: "Creativity",
  "Open-minded": "Creativity",
  Innovator: "Creativity",
  Planner: "Discipline",
  Organized: "Discipline",
  Disciplined: "Discipline",
  Perfectionist: "Discipline",
  Efficient: "Discipline",
  Conservative: "Discipline",
  Stable: "Discipline",
  Reliable: "Discipline",
  Completionist: "Discipline",
  Structured: "Discipline",
  "Detail-oriented": "Discipline",
};

const INSIGHT_TEMPLATES = {
  Logic: {
    high_high: {
      title: "🧠 The Masterminds",
      description: "You both approach life with logic and facts.",
      tip: "Don't forget feelings.",
    },
    low_low: {
      title: "❤️ Heart-Led Connection",
      description: "Neither of you overthinks things.",
      tip: "Pause and plan sometimes.",
    },
    diff: {
      title: "⚖️ The Anchor & The Sail",
      description: "One analyzes, the other feels.",
      tip: "Listen without fixing.",
    },
  },
  Emotion: {
    high_high: {
      title: "🌊 Soulmate Energy",
      description: "A deeply emotional bond.",
      tip: "Set boundaries.",
    },
    low_low: {
      title: "🛡️ The Chill Duo",
      description: "No drama here.",
      tip: "Check in on each other.",
    },
    diff: {
      title: "🔥 Warmth meets Stability",
      description: "One brings depth, the other stability.",
      tip: "Respect the difference.",
    },
  },
  Energy: {
    high_high: {
      title: "🚀 The Power Couple",
      description: "Unstoppable energy.",
      tip: "Avoid burnout.",
    },
    low_low: {
      title: "🏡 Sanctuary Vibes",
      description: "Home is your happy place.",
      tip: "Go out sometimes.",
    },
    diff: {
      title: "⚡ The Spark & The Home",
      description: "One pulls the other out; one recharges the other.",
      tip: "Compromise on outings.",
    },
  },
  Creativity: {
    high_high: {
      title: "🎨 The Dreamers",
      description: "Full of imagination.",
      tip: "Who pays the bills?",
    },
    low_low: {
      title: "🧱 The Realists",
      description: "Grounded and sensible.",
      tip: "Try something new.",
    },
    diff: {
      title: "🎈 The Kite & The String",
      description: "Visionary meets builder.",
      tip: "Ideas need execution.",
    },
  },
  Discipline: {
    high_high: {
      title: "🏆 The Empire Builders",
      description: "Organized and ambitious.",
      tip: "Learn to relax.",
    },
    low_low: {
      title: "🍃 The Bohemians",
      description: "Stress-free and spontaneous.",
      tip: "Set auto-pay for bills.",
    },
    diff: {
      title: "🌪️ Structure meets Chaos",
      description: "Plan meets surprise.",
      tip: "Don't nag; respect order.",
    },
  },
};

// ==========================================
// 4. Core Calculation Functions
// ==========================================
const DEFAULT_DNA = {
  Logic: 50,
  Emotion: 50,
  Energy: 50,
  Creativity: 50,
  Discipline: 50,
};

export const calculateUserDNA = (user, forceRecalculate = false) => {
  // 1. Fast Read Mode
  if (!forceRecalculate) {
    if (
      user &&
      user.dna &&
      typeof user.dna === "object" &&
      "Logic" in user.dna
    ) {
      return user.dna;
    }
    return DEFAULT_DNA;
  }

  // 2. Calculation Mode
  const dna = { Logic: 0, Emotion: 0, Energy: 0, Creativity: 0, Discipline: 0 };
  let totalTraitsFound = 0;

  if (!user || !user.questionsbycategoriesResults) return DEFAULT_DNA;

  const rawCategories = user.questionsbycategoriesResults.categories;
  let results = [];

  if (rawCategories) {
    if (Array.isArray(rawCategories)) {
      results = rawCategories;
    } else if (rawCategories instanceof Map) {
      results = Array.from(rawCategories.values()).flat();
    } else if (typeof rawCategories === "object") {
      results = Object.values(rawCategories).flat();
    }
  }

  if (results.length === 0) return DEFAULT_DNA;

  const lowerCaseMapping = {};
  for (const [key, value] of Object.entries(TRAIT_MAPPING)) {
    lowerCaseMapping[key.toLowerCase()] = value;
  }

  results.forEach((item) => {
    let traitName = item.trait;
    if (!traitName && item.questions && Array.isArray(item.questions)) {
      item.questions.forEach((q) => {
        if (q.trait) {
          const cat = lowerCaseMapping[q.trait.toLowerCase().trim()];
          if (cat) {
            dna[cat]++;
            totalTraitsFound++;
          }
        }
      });
      return;
    }
    if (traitName && typeof traitName === "string") {
      const cat = lowerCaseMapping[traitName.toLowerCase().trim()];
      if (cat) {
        dna[cat]++;
        totalTraitsFound++;
      }
    }
  });

  if (totalTraitsFound > 0) {
    for (const key in dna) {
      dna[key] = Math.round((dna[key] / totalTraitsFound) * 100);
      if (dna[key] < 10) dna[key] = 10;
      if (dna[key] > 95) dna[key] = 95;
    }
    return dna;
  }

  return DEFAULT_DNA;
};

export const calculateCompatibility = (me, other) => {
  if (!me || !other) return 0;

  const myDNA = calculateUserDNA(me);
  const otherDNA = calculateUserDNA(other);

  let dnaSimilaritySum = 0;
  const axes = ["Logic", "Emotion", "Energy", "Creativity", "Discipline"];

  axes.forEach((axis) => {
    const myValue = myDNA[axis];
    const otherValue = otherDNA[axis];

    // ✅ Fix 7: Better null check with logging
    if (
      myValue === null ||
      myValue === undefined ||
      otherValue === null ||
      otherValue === undefined
    ) {
      console.warn(
        `⚠️ DNA value missing for axis ${axis}: me=${myValue}, other=${otherValue}`
      );
    }

    const diff = Math.abs((myValue || 50) - (otherValue || 50));
    dnaSimilaritySum += 100 - diff;
  });

  const avgDnaScore = dnaSimilaritySum / 5;
  const weightedDnaScore = avgDnaScore * 0.7;

  let baseScore = 0;

  const myCity = me.location?.city ? me.location.city.trim().toLowerCase() : "";
  const otherCity = other.location?.city
    ? other.location.city.trim().toLowerCase()
    : "";

  if (myCity && otherCity && myCity === otherCity) {
    baseScore += 15;
  }

  const myInterests = Array.isArray(me.interests) ? me.interests : [];
  const otherInterests = Array.isArray(other.interests) ? other.interests : [];

  const sharedInterests = myInterests.filter((i) => otherInterests.includes(i));
  const interestPoints = Math.min(sharedInterests.length * 3, 15);

  baseScore += interestPoints;

  const finalScore = Math.round(weightedDnaScore + baseScore);

  return Math.min(Math.max(finalScore, 0), 100);
};

export const generateMatchInsights = (me, other) => {
  const myDNA = calculateUserDNA(me);
  const otherDNA = calculateUserDNA(other);

  const insights = {
    synergies: [],
    frictions: [],
    sharedInterests: [],
    dnaComparison: { me: myDNA, other: otherDNA },
  };

  const axes = ["Logic", "Emotion", "Energy", "Creativity", "Discipline"];

  axes.forEach((axis) => {
    const myVal = myDNA[axis];
    const otherVal = otherDNA[axis];
    const diff = Math.abs(myVal - otherVal);
    const avg = (myVal + otherVal) / 2;

    let insightData = null;

    if (diff <= 25) {
      if (avg >= 60) {
        insightData = { ...INSIGHT_TEMPLATES[axis].high_high, axis };
        insights.synergies.push(insightData);
      } else if (avg <= 40) {
        insightData = { ...INSIGHT_TEMPLATES[axis].low_low, axis };
        insights.synergies.push(insightData);
      }
    } else if (diff >= 40) {
      insightData = { ...INSIGHT_TEMPLATES[axis].diff, axis };
      insights.frictions.push(insightData);
    }
  });

  const myInterests = Array.isArray(me.interests) ? me.interests : [];
  const otherInterests = Array.isArray(other.interests) ? other.interests : [];
  insights.sharedInterests = myInterests.filter((i) =>
    otherInterests.includes(i)
  );

  insights.synergies = shuffleArray(insights.synergies);
  insights.frictions = shuffleArray(insights.frictions);

  return insights;
};

export const shuffleArray = (array) => {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
};
