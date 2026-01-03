// backend/workers/matchWorker.js
import User from "../models/User.js";
import cron from "node-cron";
// 👇 1. Import kardan haman tabeyi ke dar Profile estefade mikonim
import { calculateCompatibility } from "../utils/matchUtils.js";

const BATCH_SIZE = 50; 
let isRunning = false;

// Zaman-bandi: Har 4 saat
cron.schedule("0 */4 * * *", async () => {
  if (isRunning) return;
  isRunning = true;
  console.log(`⏰ Internal Match Job Started...`);
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
    // Select users needing update
    const usersBatch = await User.find({
      $or: [
        { lastMatchCalculation: { $exists: false } },
        { lastMatchCalculation: { $lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } }
      ]
    })
    // ✅ Mohem: Bayad hame etelaat lazem baraye calculateCompatibility ro begirim
    .select("dna location lookingFor name interests birthday gender subscription") 
    .lean()
    .limit(BATCH_SIZE);

    if (usersBatch.length === 0) {
      hasMoreUsers = false;
      break;
    }

    await Promise.all(usersBatch.map(user => findMatchesForUser(user).catch(err => 
        console.error(`Error on user ${user._id}:`, err.message)
    )));

    totalProcessed += usersBatch.length;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  if (totalProcessed > 0) console.log(`✅ Cycle Finished. Total: ${totalProcessed}`);
}

async function findMatchesForUser(currentUser) {
  if (!currentUser.location || !currentUser.location.country) {
      await User.updateOne({ _id: currentUser._id }, { lastMatchCalculation: new Date() });
      return;
  }

  const myDNA = currentUser.dna || { Logic: 50, Emotion: 50, Energy: 50, Creativity: 50, Discipline: 50 };
  
  let genderFilter = {};
  if (currentUser.lookingFor && currentUser.lookingFor !== 'everyone') {
     genderFilter = { gender: { $regex: new RegExp(`^${currentUser.lookingFor}$`, "i") } }; 
  }

  // 1. Estefade az Aggregation FAGHAT baraye peyda kardan candidate ha (Filter + Rough Sort)
  // Ma inja mohasebe daghigh nemikonim, faghat 300 nafar bartar ro peyda mikonim
  const candidates = await User.aggregate([
    {
      $match: {
        _id: { $ne: currentUser._id },
        "location.country": currentUser.location.country, 
        ...genderFilter
      }
    },
    {
      $addFields: {
        // Mohasebe taghribi baraye sort kardan avalie
        dnaDiff: {
          $add: [
            { $abs: { $subtract: ["$dna.Logic", myDNA.Logic] } },
            { $abs: { $subtract: ["$dna.Emotion", myDNA.Emotion] } },
            { $abs: { $subtract: ["$dna.Energy", myDNA.Energy] } },
            { $abs: { $subtract: ["$dna.Creativity", myDNA.Creativity] } },
            { $abs: { $subtract: ["$dna.Discipline", myDNA.Discipline] } }
          ]
        }
      }
    },
    { $sort: { dnaDiff: 1 } }, // Kamtarin ekhtelaf DNA ro peyda kon
    { $limit: 300 }, // 300 nafar aval ro entekhab kon
  ]);

  // 2. 🟢 Mohasebe DAGHIGH ba JavaScript (Haman tabe Profile)
  const formattedMatches = candidates.map(candidate => {
    // Tabdil be object sade agar niaz bashad, ama calculateCompatibility obmject user ro mikhad
    // Chon candidate az aggregate omade, shamele field haye user hast.
    
    // ✅ Inja mojze etefagh miofte: estefade az haman Logic
    const exactScore = calculateCompatibility(currentUser, candidate);

    return {
        user: candidate._id,
        matchScore: exactScore, // In adad daghighan hamoonie ke to profile neshon midim
        updatedAt: new Date()
    };
  });

  // Sort kardan nahayi bar asas emtiaz daghigh JS
  formattedMatches.sort((a, b) => b.matchScore - a.matchScore);

  // Zakhire dar DB
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