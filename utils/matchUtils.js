const TRAIT_MAPPING = {
  // Logic (منطق & عقلانیت)
  "Solver": "Logic", "Analytical": "Logic", "Rational": "Logic", 
  "Thinker": "Logic", "Scientific": "Logic", "Pragmatist": "Logic", 
  "Optimizer": "Logic", "Determinist": "Logic", "Technical": "Logic", 
  "Objective": "Logic", "Critical": "Logic",

  // Emotion (احساس & همدلی)
  "Feeler": "Emotion", "Empathetic": "Emotion", "Sensitive": "Emotion", 
  "Romantic": "Emotion", "Nurturing": "Emotion", "Humanist": "Emotion", 
  "Peacekeeper": "Emotion", "Emotional": "Emotion", "Sentimental": "Emotion", 
  "Kind": "Emotion", "Compassionate": "Emotion",

  // Energy (انرژی & برونگرایی)
  "Active": "Energy", "Energetic": "Energy", "Extrovert": "Energy", 
  "Social": "Energy", "Adventurous": "Energy", "Risk Taker": "Energy", 
  "Spontaneous": "Energy", "Playful": "Energy", "Leader": "Energy", 
  "Outgoing": "Energy",

  // Creativity (خلاقیت & گشودگی)
  "Creator": "Creativity", "Artist": "Creativity", "Creative": "Creativity", 
  "Visual": "Creativity", "Storyteller": "Creativity", "Abstract": "Creativity", 
  "Dreamer": "Creativity", "Open-minded": "Creativity", "Innovator": "Creativity",

  // Discipline (نظم & وظیفه‌شناسی)
  "Planner": "Discipline", "Organized": "Discipline", "Disciplined": "Discipline", 
  "Perfectionist": "Discipline", "Efficient": "Discipline", "Conservative": "Discipline", 
  "Stable": "Discipline", "Reliable": "Discipline", "Completionist": "Discipline", 
  "Structured": "Discipline"
};


export const calculateUserDNA = (user) => {
  // مقادیر اولیه
  const dna = { Logic: 0, Emotion: 0, Energy: 0, Creativity: 0, Discipline: 0 };
  let totalTraitsFound = 0;

  // --- FIX: چک کردن اینکه آیا user یا پاسخ‌ها وجود دارند یا خیر ---
  if (!user || !user.questionsbycategoriesResults) {
    return { Logic: 50, Emotion: 50, Energy: 50, Creativity: 50, Discipline: 50 };
  }

  // استخراج دسته‌ها با اطمینان از اینکه آرایه است
  const rawCategories = user.questionsbycategoriesResults.categories;
  const results = Array.isArray(rawCategories) ? rawCategories : [];

  if (results.length === 0) {
    return { Logic: 50, Emotion: 50, Energy: 50, Creativity: 50, Discipline: 50 };
  }

  // حلقه روی تمام دسته‌ها و سوالات
  results.forEach(cat => {
    if (cat && Array.isArray(cat.questions)) { // اطمینان از اینکه questions آرایه است
      cat.questions.forEach(q => {
        const trait = q.trait;
        const category = TRAIT_MAPPING[trait];

        if (category) {
          dna[category] += 1;
          totalTraitsFound++;
        }
      });
    }
  });

  // نرمال‌سازی (تبدیل تعداد به درصد 0 تا 100)
  if (totalTraitsFound > 0) {
    for (const key in dna) {
      dna[key] = Math.round((dna[key] / totalTraitsFound) * 100);
      
      // جلوگیری از صفر یا صد مطلق
      if (dna[key] < 10) dna[key] = 10;
      if (dna[key] > 95) dna[key] = 95;
    }
  } else {
    // اگر هیچ تریتی پیدا نشد
    return { Logic: 50, Emotion: 50, Energy: 50, Creativity: 50, Discipline: 50 };
  }

  return dna;
};

export const calculateCompatibility = (me, other) => {
  if (!me || !other) return 0;

  // A. محاسبه DNA هر دو نفر
  const myDNA = calculateUserDNA(me);
  const otherDNA = calculateUserDNA(other);

  // B. محاسبه شباهت DNA (وزن: 70 درصد کل امتیاز)
  let dnaSimilaritySum = 0;
  const axes = ["Logic", "Emotion", "Energy", "Creativity", "Discipline"];

  axes.forEach(axis => {
    const diff = Math.abs((myDNA[axis] || 50) - (otherDNA[axis] || 50));
    dnaSimilaritySum += (100 - diff);
  });

  // میانگین شباهت در 5 محور
  const avgDnaScore = dnaSimilaritySum / 5; 
  const weightedDnaScore = avgDnaScore * 0.7; // 70% وزن کل

  // C. محاسبه شباهت پایه (وزن: 30 درصد کل امتیاز)
  let baseScore = 0;

  // 1. شهر مشترک
  if (me.location?.city && other.location?.city && 
      me.location.city.toLowerCase() === other.location.city.toLowerCase()) {
    baseScore += 15;
  }

  // 2. علایق مشترک
  const myInterests = Array.isArray(me.interests) ? me.interests : [];
  const otherInterests = Array.isArray(other.interests) ? other.interests : [];
  
  const sharedInterests = myInterests.filter(i => otherInterests.includes(i));
  const interestPoints = Math.min(sharedInterests.length * 3, 15);
  
  baseScore += interestPoints;

  // D. جمع نهایی
  const finalScore = Math.round(weightedDnaScore + baseScore);

  return Math.min(Math.max(finalScore, 0), 100);
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

export const shuffleArray = (array) => {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
};