import User from "../../models/User.js";

// ==========================================
// 1. Static Database of Icebreakers (English)
// ==========================================
const STATIC_ICEBREAKERS = {
  fun: [
    "If you could have any superpower, would you choose invisibility or flight? 🦸‍♂️",
    "What is the strangest thing you have ever eaten? 🍕",
    "If your life was a movie, what would the title be? 🎬",
    "Quick confession! What's the last song you sang in the shower? 🎤",
    "If you had to eat only one meal for the rest of your life, what would it be? 🌮",
    "What's the worst purchase you've ever made? 💸",
    "If you were an animal, what do you think you'd be? 🦁",
    "Team Coffee or Team Tea? (Choose carefully!) ☕",
    "What’s a conspiracy theory you secretly think might be true? 👽",
    "If you could instantly learn any skill, what would it be? 🎸",
    "Zombie apocalypse team: You need 3 people. Who are you taking? 🧟‍♂️",
  ],
  deep: [
    "What do you think is the biggest lesson life has taught you so far? 🤔",
    "If money wasn't an issue, where in the world would you live? 🌍",
    "Is there something you've always wanted to learn but haven't had the chance yet? 📚",
    "What is your definition of a perfect day? ✨",
    "Do you think Emotional Intelligence (EQ) is more important than IQ? 🧠",
    "If you could give one piece of advice to your younger self 10 years ago, what would it be? ⏳",
    "What makes you feel truly alive? ❤️",
    "What is one thing you are grateful for today? 🙏",
    "Do you believe in fate, or do we create our own destiny? 🔮",
  ],
  game: [
    "Let's play a game! Tell me Two Truths and a Lie, and I'll guess the lie! 🤥",
    "Truth or Dare? (I promise I won't ask anything too crazy!) 😈",
    "This or That: A trip to the mountains or a beach vacation? 🏔️🏖️",
    "This or That: Horror movies or Rom-Coms? 🍿",
    "If you woke up tomorrow with $10 million, what is the first thing you'd do? 💰",
    "Unpopular Opinion: What's a food everyone loves that you hate? 🤢",
    "Rate your day so far from 1 to 10, and tell me why! 📉📈",
  ],
  flirty: [
    "Out of all your photos, the 3rd one is a vibe! What's the story behind it? 😉",
    "If we were going out right now, where would you take me? 🥂",
    "Who do you think is the better cook? Me or you? 🍳",
    "You seem interesting, but I bet you can't beat me at Tic-Tac-Toe! ❌⭕",
    "I was going to wait for you to message me, but I have no patience. Hi! 👋",
    "On a scale of 1 to America, how free are you this weekend? 🇺🇸😉",
  ]
};

// ==========================================
// 2. Specific Questions for Categories (Surface Match)
// ==========================================
const CATEGORY_SPECIFIC_STARTERS = {
  "Music": "What's the one song you could listen to on repeat forever? 🎵",
  "Travel": "What's the next destination on your bucket list? ✈️",
  "Movies": "What's the last movie that actually made you cry (or laugh out loud)? 🎬",
  "Cooking": "What is your signature dish that impresses everyone? 🍳",
  "Gaming": "Console or PC? And what are you playing currently? 🎮",
  "Reading": "Fiction or Non-fiction? Recommend me a book! 📚",
  "Gym & Fitness": "Leg day: Love it or hate it? 💪",
  "Coffee": "How do you take your coffee? Or are you a fancy latte person? ☕",
  "Dogs": "What breed of dog do you have (or want)? 🐶",
  "Cats": "Are you a cat whisperer? 🐱",
  "Astrology": "Do you think our signs are compatible? 🔮",
  "Coding": "What's your favorite tech stack to work with? 💻",
};

// ==========================================
// 3. Main Controller Logic
// ==========================================
export const generateIcebreakers = async (req, res) => {
  try {
    const { receiverId } = req.body;
    const senderId = req.user.userId || req.user.id;

    const sender = await User.findById(senderId).select("name interests questionsbycategoriesResults");
    const receiver = await User.findById(receiverId).select("name interests questionsbycategoriesResults");

    if (!sender || !receiver) {
      return res.status(404).json({ message: "User not found" });
    }

    let suggestions = [];

    // ---------------------------------------------------
    // Step 1: Deep Matches (Exact Quiz Answers)
    // ---------------------------------------------------
    let deepCommonalities = [];

    if (sender.questionsbycategoriesResults?.categories && receiver.questionsbycategoriesResults?.categories) {
      sender.questionsbycategoriesResults.categories.forEach((sAnswers, catName) => {
        const rAnswers = receiver.questionsbycategoriesResults.categories.get(catName);
        
        if (rAnswers && Array.isArray(rAnswers)) {
          sAnswers.forEach(sAns => {
            const match = rAnswers.find(rAns => 
              rAns.questionText === sAns.questionText && 
              rAns.selectedText === sAns.selectedText
            );

            if (match) {
              // Create a context-aware sentence based on the question text
              let contextSentence = "";
              
              if (sAns.questionText.includes("What draws you")) {
                contextSentence = `I noticed we are both drawn to ${catName} because of the "${sAns.selectedText}". What do you like most about it?`;
              } else if (sAns.questionText.includes("How much time")) {
                contextSentence = `We both dedicate time to ${catName} "${sAns.selectedText}". High five for that! ✋`;
              } else if (sAns.questionText.includes("alone or with others")) {
                contextSentence = `We both prefer enjoying ${catName} "${sAns.selectedText}". Do you think that makes us compatible? 😉`;
              } else if (sAns.questionText.includes("beginner or expert")) {
                contextSentence = `So, we are both "${sAns.selectedText}" in ${catName}. Maybe we can learn something new together?`;
              } else {
                // Default fallback
                contextSentence = `I saw we both picked "${sAns.selectedText}" regarding ${catName}. Tell me more!`;
              }

              deepCommonalities.push({
                type: "🎯 Deep Match",
                text: contextSentence
              });
            }
          });
        }
      });
    }

    // Add 1 random Deep Match if available
    if (deepCommonalities.length > 0) {
      const randomDeep = deepCommonalities[Math.floor(Math.random() * deepCommonalities.length)];
      suggestions.push(randomDeep);
    }

    // ---------------------------------------------------
    // Step 2: Surface Matches (Interests Array)
    // ---------------------------------------------------
    const commonInterests = sender.interests.filter(interest => 
      receiver.interests.includes(interest)
    );

    if (commonInterests.length > 0) {
      const randomInt = commonInterests[Math.floor(Math.random() * commonInterests.length)];
      
      // Check if we have a specific question for this category, otherwise use generic
      const specificQuestion = CATEGORY_SPECIFIC_STARTERS[randomInt];
      
      let text = "";
      if (specificQuestion) {
        text = `I see you like ${randomInt}. ${specificQuestion}`;
      } else {
        const templates = [
          `It looks like we both love "${randomInt}"! Any cool stories about it?`,
          `Oh, you're into "${randomInt}" too? I bet I like it more than you! 😉`,
          `Seeing "${randomInt}" on your profile is a green flag. How did you get into it?`
        ];
        text = templates[Math.floor(Math.random() * templates.length)];
      }

      suggestions.push({
        type: "❤️ Shared Interest",
        text: text
      });
    }

    // ---------------------------------------------------
    // Step 3: Fill with Fallback Options
    // ---------------------------------------------------
    
    // Always add a Game
    const randomGame = STATIC_ICEBREAKERS.game[Math.floor(Math.random() * STATIC_ICEBREAKERS.game.length)];
    suggestions.push({
      type: "🎲 Mini Game",
      text: randomGame
    });

    // Fill remaining slots
    if (suggestions.length < 3) {
      const randomFun = STATIC_ICEBREAKERS.fun[Math.floor(Math.random() * STATIC_ICEBREAKERS.fun.length)];
      suggestions.push({
        type: "😄 Fun Starter",
        text: randomFun
      });
    }

    if (suggestions.length < 3) {
      const randomDeepQ = STATIC_ICEBREAKERS.deep[Math.floor(Math.random() * STATIC_ICEBREAKERS.deep.length)];
      suggestions.push({
        type: "🧐 Deep Question",
        text: randomDeepQ
      });
    }

    // Return top 3 unique suggestions
    // Using Map to ensure uniqueness of text just in case
    const uniqueSuggestions = Array.from(new Map(suggestions.map(item => [item.text, item])).values());

    res.status(200).json({
      suggestions: uniqueSuggestions.slice(0, 3)
    });

  } catch (error) {
    console.error("AI Wingman Error:", error);
    // ✅ Fix: Return fallback suggestions even on error (graceful degradation)
    res.status(200).json({
      suggestions: [
        { type: "🧊 Icebreaker", text: "Hey! How is your day going?" },
        { type: "🧊 Icebreaker", text: "What did you get up to this weekend?" },
        { type: "🧊 Icebreaker", text: "What kind of movies are you into?" }
      ]
    });
  }
};