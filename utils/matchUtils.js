const TRAIT_MAPPING = {
  "Solver": "Logic", "Analytical": "Logic", "Rational": "Logic", 
  "Thinker": "Logic", "Scientific": "Logic", "Pragmatist": "Logic", 
  "Optimizer": "Logic", "Determinist": "Logic", "Technical": "Logic", 
  "Objective": "Logic", "Critical": "Logic",

  "Feeler": "Emotion", "Empathetic": "Emotion", "Sensitive": "Emotion", 
  "Romantic": "Emotion", "Nurturing": "Emotion", "Humanist": "Emotion", 
  "Peacekeeper": "Emotion", "Emotional": "Emotion", "Sentimental": "Emotion", 
  "Kind": "Emotion", "Compassionate": "Emotion",

  "Active": "Energy", "Energetic": "Energy", "Extrovert": "Energy", 
  "Social": "Energy", "Adventurous": "Energy", "Risk Taker": "Energy", 
  "Spontaneous": "Energy", "Playful": "Energy", "Leader": "Energy", 
  "Outgoing": "Energy",

  "Creator": "Creativity", "Artist": "Creativity", "Creative": "Creativity", 
  "Visual": "Creativity", "Storyteller": "Creativity", "Abstract": "Creativity", 
  "Dreamer": "Creativity", "Open-minded": "Creativity", "Innovator": "Creativity",

  "Planner": "Discipline", "Organized": "Discipline", "Disciplined": "Discipline", 
  "Perfectionist": "Discipline", "Efficient": "Discipline", "Conservative": "Discipline", 
  "Stable": "Discipline", "Reliable": "Discipline", "Completionist": "Discipline", 
  "Structured": "Discipline"
};

const INSIGHT_TEMPLATES = {
  Logic: {
    high_high: {
      title: "🧠 The Masterminds",
      description: "You both approach life with logic, reason, and facts. Conversations will be stimulating, deep, and debate-heavy.",
      tip: "Don't forget to talk about feelings, not just facts."
    },
    low_low: {
      title: "❤️ Heart-Led Connection",
      description: "Neither of you overthinks things. You both follow your gut instincts and emotions rather than strict logic.",
      tip: "Make sure to pause and plan when making big life decisions."
    },
    diff: {
      title: "⚖️ The Anchor & The Sail",
      description: "One analyzes, the other feels. One plans, the other flows. It’s the perfect balance if you respect the difference.",
      tip: "The thinker should listen without fixing; the feeler should explain without blaming."
    }
  },
  Emotion: {
    high_high: {
      title: "🌊 Soulmate Energy",
      description: "A deeply emotional bond. You both understand vulnerability and can read each other's moods instantly.",
      tip: "Set boundaries so you don't absorb each other's stress too much."
    },
    low_low: {
      title: "🛡️ The Chill Duo",
      description: "No drama here. You both prefer a straightforward, practical relationship without heavy emotional waves.",
      tip: "Check in on each other occasionally to ensure needs aren't being ignored."
    },
    diff: {
      title: "🔥 Warmth meets Stability",
      description: "One brings emotional depth and color; the other provides a rock-solid, calm foundation.",
      tip: "Don't call the emotional one 'dramatic' or the calm one 'cold'."
    }
  },
  Energy: {
    high_high: {
      title: "🚀 The Power Couple",
      description: "Your combined energy is unstoppable. You'll likely be the couple that hosts every party and travels everywhere.",
      tip: "Schedule 'do nothing' days to avoid burnout."
    },
    low_low: {
      title: "🏡 Sanctuary Vibes",
      description: "You both value peace, comfort, and intimate settings over loud crowds. Home is your happy place.",
      tip: "Push each other to go out sometimes so you don't isolate."
    },
    diff: {
      title: "⚡ The Spark & The Home",
      description: "The extrovert pulls the introvert out of their shell; the introvert gives the extrovert a place to recharge.",
      tip: "Compromise: One Friday night out, next Friday night in."
    }
  },
  Creativity: {
    high_high: {
      title: "🎨 The Dreamers",
      description: "A relationship full of imagination, art, and new ideas. You will never run out of things to dream about.",
      tip: "Make sure at least one of you handles the practical bills!"
    },
    low_low: {
      title: "🧱 The Realists",
      description: "Grounded and sensible. You both value tradition, proven methods, and tangible results.",
      tip: "Try something new and unproven once in a while to keep things fresh."
    },
    diff: {
      title: "🎈 The Kite & The String",
      description: "One dreams of what could be, the other focuses on what is. The visionary leads, the realist builds.",
      tip: "Value the other's perspective: Ideas need execution, and execution needs ideas."
    }
  },
  Discipline: {
    high_high: {
      title: "🏆 The Empire Builders",
      description: "You are both organized, punctual, and ambitious. You will achieve massive goals together.",
      tip: "Learn to relax. Not everything needs to be on a to-do list."
    },
    low_low: {
      title: "🍃 The Bohemians",
      description: "Stress-free and spontaneous. Neither of you worries about strict schedules or messy rooms.",
      tip: "Set auto-pay for bills so your relaxed nature doesn't cause trouble."
    },
    diff: {
      title: "🌪️ Structure meets Chaos",
      description: "One creates the plan, the other brings the fun surprises. This is a high-friction but high-reward pairing.",
      tip: "The planner shouldn't nag; the spontaneous one should respect the planner's need for order."
    }
  }
};

export const calculateUserDNA = (user) => {
  const dna = { Logic: 0, Emotion: 0, Energy: 0, Creativity: 0, Discipline: 0 };
  let totalTraitsFound = 0;

  if (!user || !user.questionsbycategoriesResults) {
    return { Logic: 50, Emotion: 50, Energy: 50, Creativity: 50, Discipline: 50 };
  }

  const rawCategories = user.questionsbycategoriesResults.categories;
  
  let results = [];
  if (rawCategories instanceof Map) {
    results = Array.from(rawCategories.values()).flat();
  } else if (Array.isArray(rawCategories)) {
    results = rawCategories;
  } else if (typeof rawCategories === 'object' && rawCategories !== null) {
    results = Object.values(rawCategories).flat();
  }

  if (results.length === 0) {
    return { Logic: 50, Emotion: 50, Energy: 50, Creativity: 50, Discipline: 50 };
  }

  results.forEach(item => {
    if(item && item.trait) {
       const category = TRAIT_MAPPING[item.trait];
       if (category) {
         dna[category] += 1;
         totalTraitsFound++;
       }
    } else if (item && Array.isArray(item.questions)) {
       item.questions.forEach(q => {
          const category = TRAIT_MAPPING[q.trait];
          if (category) {
             dna[category] += 1;
             totalTraitsFound++;
          }
       });
    }
  });

  if (totalTraitsFound > 0) {
    for (const key in dna) {
      dna[key] = Math.round((dna[key] / totalTraitsFound) * 100);
      if (dna[key] < 10) dna[key] = 10;
      if (dna[key] > 95) dna[key] = 95;
    }
  } else {
    return { Logic: 50, Emotion: 50, Energy: 50, Creativity: 50, Discipline: 50 };
  }

  return dna;
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

  if (me.location?.city && other.location?.city && 
      me.location.city.toLowerCase() === other.location.city.toLowerCase()) {
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

export const shuffleArray = (array) => {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
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

  // شافل کردن برای تنوع در نمایش کارت‌ها
  insights.synergies = shuffleArray(insights.synergies);
  insights.frictions = shuffleArray(insights.frictions);

  return insights;
};

export const getUserVisibilityThreshold = (plan) => {
  const normalizedPlan = plan?.toLowerCase() || "free";
  switch (normalizedPlan) {
    case "platinum":
    case "premium":
      return 100;
    case "gold":
      return 90;
    case "free":
    default:
      return 80;
  }
};