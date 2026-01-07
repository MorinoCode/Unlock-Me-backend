import BlindSession from '../models/BlindSession.js';
import BlindQuestion from '../models/BlindQuestion.js';
import redisClient from '../config/redis.js'; // فایل کانفیگ بالا را ایمپورت کنید

const QUEUE_KEY = 'blind_date_queue';

export const addToQueue = async (userId, userCriteria) => {
  if (!userId) return { error: "User ID is required" };

  // ۱. دریافت کل صف از ردیس (از ایندکس ۰ تا آخر)
  const rawQueue = await redisClient.lRange(QUEUE_KEY, 0, -1);
  const waitingQueue = rawQueue.map(item => JSON.parse(item));

  // ۲. بررسی تکراری نبودن کاربر
  const existingUser = waitingQueue.find(u => u && u.userId && u.userId.toString() === userId.toString());
  
  if (existingUser) {
    return { status: "waiting", message: "Already in queue" };
  }

  // ۳. تلاش برای پیدا کردن مچ در لیست دریافتی از ردیس
  const { match: partner, matchRawString } = findMatch(userId, userCriteria, waitingQueue, rawQueue);

  if (partner) {
    // ۴. اگر مچ پیدا شد:
    
    // الف: پارتنر را از ردیس حذف کن (با استفاده از استرینگ جیسون اصلی)
    await redisClient.lRem(QUEUE_KEY, 1, matchRawString);
    
    // ب: سشن را در دیتابیس بساز
    const session = await createBlindSession(userId, partner.userId);
    
    return { status: "matched", session };
  } else {
    // ۵. اگر مچ پیدا نشد: کاربر را به صف ردیس اضافه کن
    const newUserObj = { 
      userId: userId, 
      age: userCriteria.age, 
      gender: userCriteria.gender, 
      lookingFor: userCriteria.lookingFor, 
      city: userCriteria.location?.city,       
      country: userCriteria.location?.country, 
      joinedAt: Date.now() 
    };

    await redisClient.rPush(QUEUE_KEY, JSON.stringify(newUserObj));
    
    return { status: "waiting", message: "Waiting for a match..." };
  }
};

const findMatch = (userId, criteria, queue, rawQueue) => {
  // ۱. فیلتر کردن اولیه (جنسیت و سن)
  // ما ایندکس را هم لازم داریم تا بتوانیم استرینگ خام (Raw String) را از آرایه اصلی پیدا کنیم
  const validCandidatesWithIndex = queue.map((user, index) => ({ user, index }))
    .filter(({ user }) => {
      if (!user || !user.userId) return false;

      // الف: خود کاربر نباشد
      const isNotSelf = user.userId.toString() !== userId.toString();

      // ب: اختلاف سنی حداکثر ۱۰ سال
      const ageDiff = Math.abs(user.age - criteria.age);
      const isAgeOk = ageDiff <= 10;

      // ج: منطق جنسیت
      let isGenderMatch = false;
      if (criteria.gender === 'Male') {
          isGenderMatch = (user.gender === 'Female'); 
      } else if (criteria.gender === 'Female') {
          isGenderMatch = (user.gender === 'Male');
      } else {
          isGenderMatch = (user.gender === 'Other' || user.gender === criteria.gender);
      }

      // د: بررسی دوطرفه
      const isReciprocal = (user.lookingFor === criteria.gender);

      return isNotSelf && isAgeOk && isGenderMatch && isReciprocal;
    });

  if (validCandidatesWithIndex.length === 0) return { match: null, matchRawString: null };

  // ۲. اولویت‌بندی بر اساس لوکیشن

  // اولویت ۱: هم‌شهری و هم‌کشوری
  let selectedCandidate = validCandidatesWithIndex.find(({ user }) => 
    user.country === criteria.location?.country && 
    user.city === criteria.location?.city
  );

  // اولویت ۲: فقط هم‌کشوری
  if (!selectedCandidate) {
    selectedCandidate = validCandidatesWithIndex.find(({ user }) => 
      user.country === criteria.location?.country
    );
  }

  // اگر نبود، اولین نفر واجد شرایط (بر اساس زمان ورود)
  // (اختیاری: اگر می‌خواهید حتما هم‌کشوری باشد، این خط پایین را حذف کنید)
  // if (!selectedCandidate) {
  //    selectedCandidate = validCandidatesWithIndex[0];
  // }

  if (selectedCandidate) {
    // ما باید "استرینگ خام" را برگردانیم تا ردیس بتواند دقیقا همان را حذف کند
    const rawString = rawQueue[selectedCandidate.index];
    return { match: selectedCandidate.user, matchRawString: rawString };
  }

  return { match: null, matchRawString: null };
};

const createBlindSession = async (u1Id, u2Id) => {
  const firstQuestions = await BlindQuestion.aggregate([
    { $match: { stage: 1 } },
    { $sample: { size: 5 } }
  ]);

  const newSession = new BlindSession({
    participants: [u1Id, u2Id],
    status: 'instructions', // ✅ تغییر: شروع با راهنما
    currentStage: 1,
    currentQuestionIndex: 0,
    questions: firstQuestions.map(q => ({
      questionId: q._id,
      u1Answer: null,
      u2Answer: null
    }))
  });

  const savedSession = await newSession.save();
  return await BlindSession.findById(savedSession._id).populate('questions.questionId');
};