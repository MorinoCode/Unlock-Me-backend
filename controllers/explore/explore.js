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

    
    const currentUser = await User.findById(currentUserId);
    if (!currentUser) return res.status(404).json({ message: "User not found" });

    
    const allUsersInCountry = await User.find({
      _id: { $ne: currentUserId },
      "location.country": country
    }).select("name avatar bio interests location birthday questionsbycategoriesResults subscription");

    
    const sections = {
      
      exactMatches: allUsersInCountry.filter(user => {
        const isSameCity = user.location?.city === currentUser.location?.city;
        const compatibility = calculateCompatibility(currentUser, user);
        return isSameCity && compatibility >= 80; 
      }),

     
      cityMatches: allUsersInCountry.filter(user => 
        user.location?.city === currentUser.location?.city
      ),

      
      interestMatches: allUsersInCountry.filter(user => 
        user.interests.some(interest => currentUser.interests.includes(interest))
      ),

      
      countryMatches: allUsersInCountry
    };

    res.status(200).json(sections);

  } catch (err) {
    console.error("Explore Error:", err);
    res.status(500).json({ message: "Server error", err });
  }
};


function calculateCompatibility(me, other) {
  let score = 0;
  let totalTraits = 0;

  
  const sharedInterests = me.interests.filter(i => other.interests.includes(i));
  score += (sharedInterests.length * 10); 

  
  if (me.questionsbycategoriesResults?.categories && other.questionsbycategoriesResults?.categories) {
    const myCategories = Array.from(me.questionsbycategoriesResults.categories.keys());
    
    myCategories.forEach(cat => {
      const myAnswers = me.questionsbycategoriesResults.categories.get(cat);
      const otherAnswers = other.questionsbycategoriesResults.categories.get(cat);

      if (otherAnswers) {
        myAnswers.forEach((q, index) => {
          if (otherAnswers[index] && q.trait === otherAnswers[index].trait) {
            score += 15; 
          }
          totalTraits++;
        });
      }
    });
  }

  return Math.min(score, 100);
}