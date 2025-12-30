import BlindSession from '../models/BlindSession.js';
import BlindQuestion from '../models/BlindQuestion.js';

let waitingQueue = [];

export const addToQueue = async (userId, userCriteria) => {
  if (!userId) return { error: "User ID is required" };

  // جلوگیری از کرش: چک کردن وجود userId قبل از toString
  const existingIndex = waitingQueue.findIndex(u => u && u.userId && u.userId.toString() === userId.toString());
  
  if (existingIndex !== -1) {
    return { status: "waiting", message: "Already in queue" };
  }

  const partner = findMatch(userId, userCriteria);

  if (partner) {
    // حذف پارتنر از صف
    waitingQueue = waitingQueue.filter(u => u.userId.toString() !== partner.userId.toString());
    
    // ایجاد سشن و برگرداندن آن
    const session = await createBlindSession(userId, partner.userId);
    return { status: "matched", session };
  } else {
    // اضافه کردن به صف با ساختار تمیز
    waitingQueue.push({ 
      userId: userId, 
      age: userCriteria.age, 
      gender: userCriteria.gender, 
      lookingFor: userCriteria.lookingFor, 
      joinedAt: Date.now() 
    });
    return { status: "waiting", message: "Waiting for a match..." };
  }
};

const findMatch = (userId, criteria) => {
    console.log("Checking match for:", userId, "Criteria:", criteria);
  console.log("Current Waiting Queue Size:", waitingQueue.length);
  return waitingQueue.find(user => {
    if (!user || !user.userId) return false;

    const ageDiff = Math.abs(user.age - criteria.age);
    const isGenderMatch = user.gender === criteria.lookingFor && user.lookingFor === criteria.gender;
    
    return user.userId.toString() !== userId.toString() && 
           ageDiff <= 10 && 
           isGenderMatch;
  });
};

const createBlindSession = async (u1Id, u2Id) => {
  // پیدا کردن ۵ سوال تصادفی برای مرحله اول
  const firstQuestions = await BlindQuestion.aggregate([
    { $match: { stage: 1 } },
    { $sample: { size: 5 } }
  ]);

  const newSession = new BlindSession({
    participants: [u1Id, u2Id],
    status: 'active',
    currentStage: 1,
    currentQuestionIndex: 0,
    questions: firstQuestions.map(q => ({
      questionId: q._id,
      u1Answer: null,
      u2Answer: null
    }))
  });

  // لود کردن متن سوالات برای فرستادن به فرانت‌اِند
  const savedSession = await newSession.save();
  return await BlindSession.findById(savedSession._id).populate('questions.questionId');
};