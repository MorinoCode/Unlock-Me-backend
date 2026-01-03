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
  PREMIUM: "premium",
};

export const getVisibilityThreshold = (plan) => {
  const normalizedPlan = plan?.toLowerCase() || PLANS.FREE;
  switch (normalizedPlan) {
    case PLANS.PREMIUM:
    case "platinum":
      return 100;
    case PLANS.GOLD:
      return 90;
    case PLANS.FREE:
    default:
      return 80;
  }
};

export const getSoulmatePermissions = (plan) => {
  const normalizedPlan = plan?.toLowerCase() || PLANS.FREE;
  switch (normalizedPlan) {
    case PLANS.PREMIUM:
    case "platinum":
      return { isLocked: false, limit: Infinity };
    case PLANS.GOLD:
      return { isLocked: false, limit: 5 };
    default:
      return { isLocked: true, limit: 0 };
  }
};

export const getPromoBannerConfig = (plan) => {
  const normalizedPlan = plan?.toLowerCase() || PLANS.FREE;
  switch (normalizedPlan) {
    case PLANS.PREMIUM:
    case "platinum":
      return { showGold: false, showPlatinum: false, showBoost: true };
    case PLANS.GOLD:
      return { showGold: false, showPlatinum: true, showBoost: true };
    default:
      return { showGold: true, showPlatinum: true, showBoost: true };
  }
};

// ==========================================
// 3. Data Mappings
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
const DEFAULT_DNA = { Logic: 50, Emotion: 50, Energy: 50, Creativity: 50, Discipline: 50 };
export const calculateUserDNA = (user, forceRecalculate = false) => {
  
  // 1. حالت خواندن سریع (Explore Mode) 🚀
  if (!forceRecalculate) {
      // اگر در دیتابیس موجود بود، همان را بده
      if (user && user.dna && typeof user.dna === 'object' && 'Logic' in user.dna) {
          return user.dna;
      }
      // اگر نبود، محاسبه نکن! فقط دیفالت بده (Safety Return)
      return DEFAULT_DNA;
  }

  // 2. حالت محاسبه سنگین (Update Profile Mode) 🏗️
  // (فقط وقتی اجرا می‌شود که forceRecalculate = true باشد)
  
  const dna = { Logic: 0, Emotion: 0, Energy: 0, Creativity: 0, Discipline: 0 };
  let totalTraitsFound = 0;

  if (!user || !user.questionsbycategoriesResults) return DEFAULT_DNA;

  const rawCategories = user.questionsbycategoriesResults.categories;
  let results = [];

  // هندل کردن انواع دیتا (Array, Map, Object)
  if (rawCategories) {
    if (Array.isArray(rawCategories)) {
      results = rawCategories;
    } else if (rawCategories instanceof Map) {
      results = Array.from(rawCategories.values()).flat();
    } else if (typeof rawCategories === 'object') {
      results = Object.values(rawCategories).flat();
    }
  }

  if (results.length === 0) return DEFAULT_DNA;

  const lowerCaseMapping = {};
  for (const [key, value] of Object.entries(TRAIT_MAPPING)) {
      lowerCaseMapping[key.toLowerCase()] = value;
  }

  results.forEach(item => {
    // ... (همان منطق قبلی برای پیدا کردن trait) ...
    let traitName = item.trait;
    if (!traitName && item.questions && Array.isArray(item.questions)) {
       item.questions.forEach(q => {
          if (q.trait) {
             const cat = lowerCaseMapping[q.trait.toLowerCase().trim()];
             if (cat) { dna[cat]++; totalTraitsFound++; }
          }
       });
       return; 
    }
    if (traitName && typeof traitName === 'string') {
        const cat = lowerCaseMapping[traitName.toLowerCase().trim()];
        if (cat) { dna[cat]++; totalTraitsFound++; }
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

  axes.forEach(axis => {
    const diff = Math.abs((myDNA[axis] || 50) - (otherDNA[axis] || 50));
    dnaSimilaritySum += (100 - diff);
  });

  const avgDnaScore = dnaSimilaritySum / 5;
  const weightedDnaScore = avgDnaScore * 0.7;

  let baseScore = 0;

  // فیکس: تریم کردن نام شهرها
  const myCity = me.location?.city ? me.location.city.trim().toLowerCase() : "";
  const otherCity = other.location?.city ? other.location.city.trim().toLowerCase() : "";

  if (myCity && otherCity && myCity === otherCity) {
    baseScore += 15;
  }

  const myInterests = Array.isArray(me.interests) ? me.interests : [];
  const otherInterests = Array.isArray(other.interests) ? other.interests : [];
  
  const sharedInterests = myInterests.filter(i => otherInterests.includes(i));
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
    dnaComparison: { me: myDNA, other: otherDNA }
  };

  const axes = ["Logic", "Emotion", "Energy", "Creativity", "Discipline"];

  axes.forEach(axis => {
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
    } 
    else if (diff >= 40) {
      insightData = { ...INSIGHT_TEMPLATES[axis].diff, axis };
      insights.frictions.push(insightData);
    }
  });

  const myInterests = Array.isArray(me.interests) ? me.interests : [];
  const otherInterests = Array.isArray(other.interests) ? other.interests : [];
  insights.sharedInterests = myInterests.filter(i => otherInterests.includes(i));

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