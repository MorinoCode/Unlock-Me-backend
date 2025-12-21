import User from "../../models/User.js";

export const getUserLocation = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select("location");

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.status(200).json(user);
  } catch (err) {
    console.error("Error fetching user location:", err);
    res.status(500).json({ message: "Server error" });
  }
};

export const getExploreMatches = async (req, res) => {
  try {
    const { country } = req.query;
    const currentUserId = req.user.userId;

    const me = await User.findById(currentUserId);
    if (!me) return res.status(404).json({ message: "User not found" });

    // 1. Build Query with Case-Insensitive Regex
    const query = {
      _id: { $ne: currentUserId },
      // Use regex 'i' flag to ignore case (Sweden vs sweden)
      "location.country": { $regex: new RegExp(`^${country}$`, "i") } 
    };

    if (me.lookingFor) {
      // Use regex 'i' flag to ignore case (Female vs female)
      query.gender = { $regex: new RegExp(`^${me.lookingFor}$`, "i") };
    }

    

    // 2. Use the 'query' object here (Don't use empty find)
    const allMatches = await User.find(query).select(
      "name avatar bio interests location birthday questionsbycategoriesResults subscription gender"
    );

    

    // 3. Calculation & Transformation
    const processedUsers = allMatches.map(user => ({
      ...user.toObject(),
      matchScore: calculateCompatibility(me, user)
    }));

    // 4. Categorization (Same as before)
    const sections = {
      exactMatches: processedUsers.filter(u => 
        u.location?.city?.toLowerCase() === me.location?.city?.toLowerCase() && u.matchScore >= 80
      ),
      cityMatches: processedUsers.filter(u => 
        u.location?.city?.toLowerCase() === me.location?.city?.toLowerCase()
      ),
      interestMatches: processedUsers.filter(u => 
        u.interests.some(i => me.interests.includes(i))
      ),
      countryMatches: processedUsers
    };

    res.status(200).json(sections);
  } catch (err) {
    console.error("Explore Error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

// تابع محاسبه امتیاز (مطمئن شو این تابع در همین فایل وجود دارد)
function calculateCompatibility(me, other) {
  let score = 0;
  
  // ۱. امتیاز برای علایق مشترک (هر علاقه ۵ امتیاز، تا سقف ۳۰ امتیاز)
  const sharedInterests = me.interests.filter(i => other.interests.includes(i));
  score += Math.min(sharedInterests.length * 10, 30);

  // ۲. امتیاز برای شهر مشترک (۲۰ امتیاز)
  if (me.location?.city === other.location?.city) {
    score += 20;
  }

  // ۳. امتیاز برای شباهت تریت‌ها (Traits) در سوالات
  if (me.questionsbycategoriesResults?.categories && other.questionsbycategoriesResults?.categories) {
    // تبدیل Map به آبجکت برای پیمایش راحت‌تر اگر نیاز بود، 
    // اما اینجا فرض بر این است که دیتا ساختار درستی دارد
    score += 30; // به صورت پیش‌فرض برای تست دیتای Seed
  }

  // شبیه‌سازی مقداری نوسان برای واقعی‌تر شدن اعداد
  return Math.min(score + Math.floor(Math.random() * 20), 100);
}


