import mongoose from "mongoose";
import dotenv from "dotenv";
import BlindQuestion from "./models/BlindQuestion.js";

dotenv.config();

const questions = [
  // --- STAGE 1 (30 Questions) ---
  {
    text: "If you could win a free trip right now, where would you go?",
    options: [
      "A remote cabin in the woods",
      "A luxury penthouse in a busy city",
      "A van-life road trip across the coast",
    ],
    category: "Travel",
    stage: 1,
  },
  {
    text: "What is your absolute favorite way to spend a Friday night?",
    options: [
      "Dancing and socializing at a club",
      "Ordering pizza and watching movies",
      "Working on a personal hobby or project",
    ],
    category: "Lifestyle",
    stage: 1,
  },
  {
    text: "Which superpower would be most useful for a first date?",
    options: [
      "Mind reading",
      "Truth detection",
      "Time travel (to fix awkward moments)",
    ],
    category: "Fun",
    stage: 1,
  },
  {
    text: "How do you usually handle a Sunday morning?",
    options: [
      "Early gym session and productivity",
      "Sleep until noon",
      "Long brunch with friends",
    ],
    category: "Routine",
    stage: 1,
  },
  {
    text: "If your life was a movie genre, which one would it be?",
    options: [
      "A fast-paced Action movie",
      "A slow-burn Indie Drama",
      "A chaotic Comedy",
    ],
    category: "Personality",
    stage: 1,
  },
  {
    text: "What is your 'guilty pleasure' when it comes to food?",
    options: [
      "Midnight fast food run",
      "Expensive gourmet desserts",
      "Eating a whole jar of Nutella/Peanut butter",
    ],
    category: "Food",
    stage: 1,
  },
  {
    text: "If you could have dinner with any historical figure, who would you pick?",
    options: [
      "An iconic artist or musician",
      "A brilliant scientist",
      "A powerful world leader",
    ],
    category: "Interest",
    stage: 1,
  },
  {
    text: "What is your stance on 'Social Media' in a relationship?",
    options: [
      "Post everything together",
      "Keep it completely private",
      "Only post on special occasions",
    ],
    category: "Social",
    stage: 1,
  },
  {
    text: "Which animal best represents your social energy?",
    options: [
      "An outgoing Golden Retriever",
      "A selective and independent Cat",
      "A wise and quiet Owl",
    ],
    category: "Personality",
    stage: 1,
  },
  {
    text: "How do you react to a spontaneous plan?",
    options: [
      "Love it! Let's go now",
      "I need at least 24 hours notice",
      "Depends on who else is coming",
    ],
    category: "Lifestyle",
    stage: 1,
  },
  {
    text: "What is your favorite season of the year?",
    options: [
      "Summer vibes and beaches",
      "Cozy Winter nights",
      "Fresh Spring or Autumn walks",
    ],
    category: "Nature",
    stage: 1,
  },
  {
    text: "If you won $1 million today, what is the first thing you'd buy?",
    options: ["A dream house", "A luxury car", "A ticket to travel the world"],
    category: "Finance",
    stage: 1,
  },
  {
    text: "What kind of music controls your mood?",
    options: [
      "Upbeat Pop/Electronic",
      "Deep Jazz/Classical",
      "Raw Rock/Alternative",
    ],
    category: "Music",
    stage: 1,
  },
  {
    text: "Are you a morning person or a night owl?",
    options: [
      "Early bird catches the worm",
      "Night owl - my brain starts at 10 PM",
      "I'm tired all day regardless",
    ],
    category: "Routine",
    stage: 1,
  },
  {
    text: "Which of these is a total 'deal-breaker' for you?",
    options: [
      "Rudeness to waiters",
      "No sense of humor",
      "Being constantly late",
    ],
    category: "Values",
    stage: 1,
  },
  {
    text: "If you could live in any fictional world, which would it be?",
    options: [
      "A world of Magic (Harry Potter style)",
      "A high-tech Future (Cyberpunk)",
      "A peaceful Fantasy land (Lord of the Rings)",
    ],
    category: "Fun",
    stage: 1,
  },
  {
    text: "What is your dream job if money didn't matter?",
    options: [
      "Professional traveler/Explorer",
      "Artist/Creative creator",
      "Helping people/Animal rescuer",
    ],
    category: "Ambition",
    stage: 1,
  },
  {
    text: "How do you usually discover new music or movies?",
    options: [
      "Algorithm recommendations",
      "Recommendations from friends",
      "Spending hours digging myself",
    ],
    category: "Lifestyle",
    stage: 1,
  },
  {
    text: "What is your favorite type of weather?",
    options: [
      "Thunderstorms and rain",
      "Perfectly clear sunny sky",
      "Cool breeze and cloudy",
    ],
    category: "Nature",
    stage: 1,
  },
  {
    text: "If you were a color, which one would you be?",
    options: [
      "Bold and passionate Red",
      "Calm and deep Blue",
      "Energetic and bright Yellow",
    ],
    category: "Personality",
    stage: 1,
  },
  {
    text: "What is your biggest 'pet peeve' in a conversation?",
    options: [
      "People interrupting me",
      "People on their phones",
      "People talking too much about themselves",
    ],
    category: "Social",
    stage: 1,
  },
  {
    text: "How do you handle stress?",
    options: [
      "Exercise and movement",
      "Isolation and silence",
      "Talking it out with someone",
    ],
    category: "Emotional",
    stage: 1,
  },
  {
    text: "What is your favorite 'Small Talk' topic?",
    options: [
      "Current events/News",
      "Movies and TV shows",
      "Deep 'What if' questions",
    ],
    category: "Social",
    stage: 1,
  },
  {
    text: "If you could learn any language instantly, what would it be?",
    options: [
      "A romantic language (French/Italian)",
      "A complex language (Chinese/Japanese)",
      "A fictional language (Elvish/Klingon)",
    ],
    category: "Skill",
    stage: 1,
  },
  {
    text: "What is your ideal first date activity?",
    options: [
      "Classic dinner and drinks",
      "Something active like Bowling or Mini-golf",
      "A quiet walk in a park or gallery",
    ],
    category: "Dating",
    stage: 1,
  },
  {
    text: "Do you prefer big parties or small gatherings?",
    options: [
      "The more the merrier!",
      "Just a few close friends",
      "I'm a solo traveler",
    ],
    category: "Social",
    stage: 1,
  },
  {
    text: "What is the best way to cheer you up?",
    options: [
      "Food and snacks",
      "Funny memes or videos",
      "A long hug and support",
    ],
    category: "Emotional",
    stage: 1,
  },
  {
    text: "If you could change one thing about your past, would you?",
    options: [
      "Yes, to avoid a specific mistake",
      "No, it made me who I am",
      "Only if I could keep my current knowledge",
    ],
    category: "Values",
    stage: 1,
  },
  {
    text: "What is your most used Emoji?",
    options: [
      "The laughing face 😂",
      "The heart/eyes 😍",
      "The 'cool' sunglasses 😎",
    ],
    category: "Fun",
    stage: 1,
  },
  {
    text: "What is your 'comfort movie' that you can watch forever?",
    options: [
      "A classic childhood animation",
      "A cheesy romantic comedy",
      "A mind-bending sci-fi",
    ],
    category: "Lifestyle",
    stage: 1,
  },

  // --- STAGE 2 (30 Questions) ---
  {
    text: "What is the most important foundation for a long-term relationship?",
    options: ["Complete honesty", "Physical chemistry", "Shared life goals"],
    category: "Relationship",
    stage: 2,
  },
  {
    text: "How do you prefer to resolve a disagreement?",
    options: [
      "Discuss it immediately",
      "Take some time to cool off first",
      "Write down my feelings",
    ],
    category: "Communication",
    stage: 2,
  },
  {
    text: "What does 'loyalty' mean to you in one word?",
    options: ["Protection", "Consistency", "Transparency"],
    category: "Values",
    stage: 2,
  },
  {
    text: "If you had to move to another country tomorrow, what would you miss most?",
    options: [
      "Your family and friends",
      "Your comfort and routine",
      "The food and culture",
    ],
    category: "Emotional",
    stage: 2,
  },
  {
    text: "What is your biggest fear regarding a serious relationship?",
    options: [
      "Losing my independence",
      "Being betrayed",
      "Growing apart over time",
    ],
    category: "Fear",
    stage: 2,
  },
  {
    text: "How do you view 'Money' in a partnership?",
    options: [
      "Everything should be shared",
      "Total financial independence",
      "Common pool for bills, separate for personal",
    ],
    category: "Finance",
    stage: 2,
  },
  {
    text: "What is your 'Love Language'?",
    options: [
      "Words of affirmation",
      "Quality time",
      "Physical touch/Acts of service",
    ],
    category: "Relationship",
    stage: 2,
  },
  {
    text: "How much 'Alone Time' do you need when living with someone?",
    options: [
      "A lot - I need my own space",
      "Very little - I love being together",
      "Just a few hours a week",
    ],
    category: "Lifestyle",
    stage: 2,
  },
  {
    text: "What is your opinion on 'White Lies' to protect a partner's feelings?",
    options: [
      "Sometimes necessary",
      "Never acceptable - truth always",
      "Depends on how big the lie is",
    ],
    category: "Ethics",
    stage: 2,
  },
  {
    text: "What are you most proud of in your life so far?",
    options: [
      "My career achievements",
      "My personal growth/healing",
      "The relationships I've built",
    ],
    category: "Self",
    stage: 2,
  },
  {
    text: "How do you handle a partner who has very different political views?",
    options: [
      "We can agree to disagree",
      "It's a deal-breaker for me",
      "I enjoy the debate",
    ],
    category: "Values",
    stage: 2,
  },
  {
    text: "What is the best piece of advice you’ve ever received?",
    options: [
      "Focus on yourself first",
      "Treat others as you want to be treated",
      "Take risks while you're young",
    ],
    category: "Wisdom",
    stage: 2,
  },
  {
    text: "How do you want to be remembered by people?",
    options: [
      "As someone successful and powerful",
      "As someone kind and helpful",
      "As someone unique and creative",
    ],
    category: "Ambition",
    stage: 2,
  },
  {
    text: "What is your definition of a 'Soulmate'?",
    options: [
      "One perfect person exists for everyone",
      "Someone you choose to build a life with",
      "A spiritual connection from a past life",
    ],
    category: "Philosophy",
    stage: 2,
  },
  {
    text: "How do you feel about your partner staying friends with their Ex?",
    options: [
      "Perfectly fine - shows maturity",
      "I’m uncomfortable with it",
      "Only if I meet them too",
    ],
    category: "Trust",
    stage: 2,
  },
  {
    text: "If you could change one personality trait of yours, what would it be?",
    options: [
      "Be more confident",
      "Be less anxious/overthinking",
      "Be more disciplined",
    ],
    category: "Self",
    stage: 2,
  },
  {
    text: "What is your ultimate goal for the next 5 years?",
    options: [
      "Building a family",
      "Reaching the top of my career",
      "Living a life of freedom and travel",
    ],
    category: "Ambition",
    stage: 2,
  },
  {
    text: "How do you handle failure?",
    options: [
      "I get discouraged and quit",
      "I analyze and try again",
      "I ignore it and move on",
    ],
    category: "Emotional",
    stage: 2,
  },
  {
    text: "What makes you feel the most 'vulnerable'?",
    options: ["Sharing my secrets", "Physical intimacy", "Asking for help"],
    category: "Fear",
    stage: 2,
  },
  {
    text: "What is your view on 'Having Kids'?",
    options: [
      "Definitely want them",
      "Definitely don't want them",
      "Still undecided",
    ],
    category: "Future",
    stage: 2,
  },
  {
    text: "How do you show someone you care about them?",
    options: [
      "Giving gifts",
      "Helping them with tasks",
      "Listening deeply to them",
    ],
    category: "Relationship",
    stage: 2,
  },
  {
    text: "What is the bravest thing you've ever done?",
    options: [
      "Moving to a new city alone",
      "Standing up for someone else",
      "Admitting I was wrong",
    ],
    category: "Self",
    stage: 2,
  },
  {
    text: "Do you believe in 'Love at first sight'?",
    options: [
      "Yes, I've felt it",
      "No, it's just lust",
      "It's only possible in movies",
    ],
    category: "Philosophy",
    stage: 2,
  },
  {
    text: "What is your relationship with your parents like now?",
    options: [
      "Very close - they are my best friends",
      "Respectful but distant",
      "Complicated",
    ],
    category: "Family",
    stage: 2,
  },
  {
    text: "How do you deal with jealousy?",
    options: [
      "I get quiet and withdraw",
      "I talk about it openly",
      "I try to hide it",
    ],
    category: "Trust",
    stage: 2,
  },
  {
    text: "What is the most 'attractive' quality a person can have?",
    options: ["Intelligence", "Kindness", "Confidence"],
    category: "Dating",
    stage: 2,
  },
  {
    text: "If you could tell your younger self one thing, what would it be?",
    options: [
      "Don't worry so much",
      "Take that big risk",
      "Listen to your intuition",
    ],
    category: "Wisdom",
    stage: 2,
  },
  {
    text: "What is your biggest 'Unpopular Opinion'?",
    options: [
      "Something about food",
      "Something about modern dating",
      "Something about work culture",
    ],
    category: "Fun",
    stage: 2,
  },
  {
    text: "What does 'Home' feel like to you?",
    options: [
      "A specific place or city",
      "A specific person",
      "A feeling of safety within myself",
    ],
    category: "Emotional",
    stage: 2,
  },
  {
    text: "What is the one thing you would never sacrifice for a relationship?",
    options: [
      "My career/dreams",
      "My self-respect",
      "My relationships with friends/family",
    ],
    category: "Values",
    stage: 2,
  },
];

const questionsWithKeys = questions.map((q, i) => ({
  ...q,
  key: i < 30 ? `s1_${i}` : `s2_${i - 30}`,
}));

const seedDB = async () => {
  try {
    console.log("Connecting to DB...");
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Connected! Deleting old questions...");
    await BlindQuestion.deleteMany({});
    console.log("Inserting new questions...");
    const result = await BlindQuestion.insertMany(questionsWithKeys);
    console.log(`${result.length} questions inserted successfully!`);
    process.exit();
  } catch (err) {
    console.error("Error seeding database:", err);
    process.exit(1);
  }
};

seedDB();
