// backend/workers/matchWorker.js
import User from "../models/User.js";
import cron from "node-cron";

// تنظیمات
const BATCH_SIZE = 50; // برای سرور رایگان/ارزان، تعداد را کم کن که فشار نیاید
let isRunning = false;

console.log("✅ Match Worker loaded and scheduled.");

// ============================================================
// زمان‌بندی: هر ۴ ساعت یکبار (برای صرفه‌جویی در منابع سرور اصلی)
// فرمت: "0 */4 * * *"
// ============================================================
cron.schedule("0 */4 * * *", async () => {
  if (isRunning) {
    console.log("⚠️ Previous matching job still running. Skipping.");
    return;
  }

  isRunning = true;
  console.log(`⏰ Internal Match Job Started at ${new Date().toISOString()}`);

  try {
    await processAllUsers();
  } catch (error) {
    console.error("❌ Match Job Failed:", error);
  } finally {
    isRunning = false;
    console.log(`💤 Internal Match Job Finished.`);
  }
});

async function processAllUsers() {
  let hasMoreUsers = true;
  let totalProcessed = 0;

  while (hasMoreUsers) {
    // فقط ۵۰ تا ۵۰ تا پردازش می‌کنیم تا رم سرور اصلی پر نشود
    const usersBatch = await User.find({
      $or: [
        { lastMatchCalculation: { $exists: false } },
        { lastMatchCalculation: { $lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } }
      ]
    })
    .select("dna location lookingFor name")
    .limit(BATCH_SIZE);

    if (usersBatch.length === 0) {
      hasMoreUsers = false;
      break;
    }

    // پردازش موازی
    await Promise.all(usersBatch.map(user => findMatchesForUser(user).catch(err => 
        console.error(`Error on user ${user._id}:`, err.message)
    )));

    totalProcessed += usersBatch.length;
    
    // ۱ ثانیه استراحت بین هر ۵۰ نفر تا CPU سرور اصلی نفس بکشد و API کند نشود
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

async function findMatchesForUser(currentUser) {
    if (!currentUser.location || !currentUser.location.country) {
      // فقط تاریخ را آپدیت می‌کنیم که دوباره در لوپ بعدی نیاید
      await User.updateOne({ _id: currentUser._id }, { lastMatchCalculation: new Date() });
      return;
  }
  const myDNA = currentUser.dna || { Logic: 50, Emotion: 50, Energy: 50, Creativity: 50, Discipline: 50 };
  
  let genderFilter = {};
  if (currentUser.lookingFor) {
genderFilter = { gender: { $regex: new RegExp(`^${currentUser.lookingFor}$`, "i") } };  }

  const matches = await User.aggregate([
    {
      $match: {
        _id: { $ne: currentUser._id },
        "location.country": currentUser.location?.country,
        ...genderFilter
      }
    },
    {
      $addFields: {
        dnaDiff: {
          $add: [
            { $abs: { $subtract: ["$dna.Logic", myDNA.Logic] } },
            { $abs: { $subtract: ["$dna.Emotion", myDNA.Emotion] } },
            { $abs: { $subtract: ["$dna.Energy", myDNA.Energy] } },
            { $abs: { $subtract: ["$dna.Creativity", myDNA.Creativity] } },
            { $abs: { $subtract: ["$dna.Discipline", myDNA.Discipline] } }
          ]
        },
        cityBonus: {
          $cond: { 
             if: { $eq: [{ $toLower: "$location.city" }, { $toLower: currentUser.location?.city || "" }] }, 
             then: 15, 
             else: 0 
          }
        }
      }
    },
    {
      $addFields: {
        matchScore: {
          $add: [
            { $multiply: [ { $subtract: [500, "$dnaDiff"] }, 0.14 ] }, 
            "$cityBonus"
          ]
        }
      }
    },
    { $sort: { matchScore: -1 } },
    { $limit: 100 },
    {
      $project: {
        _id: 1, 
        matchScore: 1 
      }
    }
  ]);

  const formattedMatches = matches.map(m => ({
    user: m._id,
    matchScore: Math.round(m.matchScore),
    updatedAt: new Date()
  }));

  await User.updateOne(
      { _id: currentUser._id },
      { 
          $set: { 
              potentialMatches: formattedMatches,
              lastMatchCalculation: new Date()
          }
      }
  );
}