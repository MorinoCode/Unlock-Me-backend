import GoDate from "../../models/GoDate.js";
import User from "../../models/User.js";
import Chat from "../../models/Conversation.js"
import { emitNotification } from "../../utils/notificationHelper.js";

// --- Helper: Check Limits Based on Plan ---
const checkCreationLimit = async (user) => {
  const plan = user.subscription?.plan || 'free';
  const userId = user._id;
  const now = new Date();

  // 1. Platinum: Unlimited
  if (plan === 'platinum') return { allowed: true };

  // 2. Gold: 1 per Week
  if (plan === 'gold') {
    const oneWeekAgo = new Date(now.setDate(now.getDate() - 7));
    const count = await GoDate.countDocuments({
      creator: userId,
      createdAt: { $gte: oneWeekAgo }
    });
    if (count >= 1) return { allowed: false, message: "Gold users can create 1 date per week." };
    return { allowed: true };
  }

  // 3. Free: 1 per Month
  // (default)
  const oneMonthAgo = new Date(now.setDate(now.getDate() - 30));
  const count = await GoDate.countDocuments({
    creator: userId,
    createdAt: { $gte: oneMonthAgo }
  });
  
  if (count >= 1) return { allowed: false, message: "Free users can create 1 date per month. Upgrade to create more!" };
  
  return { allowed: true };
};

// ==========================================
// 1. CREATE DATE
// ==========================================
export const createGoDate = async (req, res) => {
  try {
    const userId = req.user._id;
    const user = await User.findById(userId);

    // A. Check Limits
    const limitCheck = await checkCreationLimit(user);
    if (!limitCheck.allowed) {
      return res.status(403).json({ error: "Limit Reached", message: limitCheck.message });
    }

    // B. Create
    const { 
      category, title, description, dateTime, 
      city, generalArea, exactAddress, 
      paymentType, preferences, image 
    } = req.body;

    const newDate = new GoDate({
      creator: userId,
      category,
      title,
      description,
      dateTime,
      location: { city, generalArea, exactAddress }, // exactAddress ذخیره می‌شود اما در لیست عمومی فرستاده نمی‌شود
      paymentType,
      preferences,
      image
    });

    await newDate.save();

    // C. (Optional) Notify matching users in the same city?
    // This can be heavy, maybe do it in a background worker later.

    res.status(201).json(newDate);

  } catch (err) {
    console.error("Create GoDate Error:", err);
    res.status(500).json({ error: "Server error" });
  }
};

// ==========================================
// 2. GET ALL DATES (BROWSE)
// ==========================================
export const getAvailableDates = async (req, res) => {
  try {
    const userId = req.user._id;
    const user = await User.findById(userId);
    const userCity = user.location?.city;

    // فیلترها:
    // 1. دیت‌های باز (Open)
    // 2. دیت‌های آینده (هنوز وقتش نگذشته)
    // 3. سازنده خود کاربر نباشد
    // 4. (اختیاری) شهر کاربر باشد
    
    const query = {
      status: 'open',
      dateTime: { $gt: new Date() }, // فقط دیت‌های آینده
      creator: { $ne: userId }
    };

    if (req.query.city || userCity) {
       // فیلتر شهر (از کوئری یا شهر خود یوزر)
       query["location.city"] = { $regex: new RegExp(`^${req.query.city || userCity}$`, "i") };
    }

    // فیلتر جنسیت (اگر دیت فقط برای زنان است، مردان نبینند)
    // این لاجیک پیچیده است، فعلاً ساده می‌گیریم: همه دیت‌ها را ببینند
    
    const dates = await GoDate.find(query)
      .populate("creator", "name avatar age gender isVerified")
      .sort({ dateTime: 1 }) // نزدیک‌ترین دیت‌ها اول
      .limit(50);

    // **SECURITY:** Remove exactAddress from response
    const sanitizedDates = dates.map(date => {
        const d = date.toObject();
        // حذف آدرس دقیق برای امنیت
        if (d.location) delete d.location.exactAddress; 
        // چک کردن اینکه آیا کاربر فعلی قبلا درخواست داده؟
        d.hasApplied = d.applicants.some(id => id.toString() === userId.toString());
        return d;
    });

    res.json(sanitizedDates);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ==========================================
// 3. GET MY DATES (Owner View)
// ==========================================
export const getMyDates = async (req, res) => {
  try {
    const userId = req.user._id;
    
    const dates = await GoDate.find({ creator: userId })
      .populate("applicants", "name avatar age gender bio") // لیست متقاضیان را کامل بفرست
      .populate("acceptedUser", "name avatar")
      .sort({ createdAt: -1 });

    // اینجا آدرس دقیق را حذف نمی‌کنیم چون سازنده خودش آن را نوشته
    res.json(dates);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ==========================================
// 4. APPLY FOR DATE (I'm Interested)
// ==========================================
export const applyForDate = async (req, res) => {
  try {
    const { dateId } = req.body;
    const userId = req.user._id;
    const io = req.app.get("io");

    const date = await GoDate.findById(dateId);
    if (!date || date.status !== 'open') {
        return res.status(404).json({ error: "Date not found or closed" });
    }

    // جلوگیری از تکرار
    if (date.applicants.includes(userId)) {
        return res.status(400).json({ error: "Already applied" });
    }

    date.applicants.push(userId);
    await date.save();

    // نوتیفیکیشن برای سازنده دیت
    const user = await User.findById(userId).select('name');
    await emitNotification(io, date.creator, {
        type: "DATE_APPLICANT",
        senderId: userId,
        senderName: user.name,
        message: `${user.name} is interested in your '${date.title}' date!`,
        targetId: date._id
    });

    res.json({ success: true, message: "Application sent" });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ==========================================
// 5. ACCEPT APPLICANT (The Main Action)
// ==========================================
export const acceptDateApplicant = async (req, res) => {
  try {
    const { dateId, applicantId } = req.body;
    const userId = req.user._id; // Creator
    const io = req.app.get("io");

    const date = await GoDate.findById(dateId);
    
    // اعتبارسنجی
    if (!date) return res.status(404).json({ error: "Date not found" });
    if (date.creator.toString() !== userId.toString()) return res.status(403).json({ error: "Not authorized" });
    if (date.status !== 'open') return res.status(400).json({ error: "Date is not open" });

    // انجام عملیات اکسپت
    date.acceptedUser = applicantId;
    date.status = 'closed'; // بستن دیت
    await date.save();

    // 1. ساخت چت روم بین این دو نفر
    // چک میکنیم چت قبلا هست یا نه
    let chat = await Chat.findOne({
        participants: { $all: [userId, applicantId] }
    });

    if (!chat) {
        chat = new Chat({
            participants: [userId, applicantId],
            messages: []
        });
    }

    // ارسال آدرس دقیق به عنوان پیام سیستم در چت
    const systemMsg = {
        senderId: userId, // یا null به عنوان سیستم
        text: `🎉 Go Date Confirmed: "${date.title}"! \n📍 Location: ${date.location.exactAddress} \n⏰ Time: ${new Date(date.dateTime).toLocaleString()}`,
        isSystemMessage: true, // باید در مدل پیام ساپورت شود یا کلاینت هندل کند
        createdAt: new Date()
    };
    
    chat.messages.push(systemMsg);
    await chat.save();

    // 2. نوتیفیکیشن برای کسی که انتخاب شده
    const creator = await User.findById(userId).select('name');
    await emitNotification(io, applicantId, {
        type: "DATE_ACCEPTED",
        senderId: userId,
        senderName: creator.name,
        message: `Your request for '${date.title}' was accepted! Check your chat.`,
        targetId: chat._id
    });

    res.json({ success: true, chatRuleId: chat._id });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};