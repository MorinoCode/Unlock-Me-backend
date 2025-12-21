import mongoose from "mongoose";
import { faker } from "@faker-js/faker";
import User from "./models/User.js"; 
import dotenv from "dotenv";
import bcrypt from "bcryptjs";

dotenv.config();

const seedDB = async () => {
  try {
    // 1. Connection to Database
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Connected to DB for smart seeding...");

    // 2. Optional: Clear existing users except your admin/test account
    // await User.deleteMany({ email: { $ne: "your-admin-email@example.com" } });

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash("password123", salt);

    const genders = ["male", "female", "other"];
    const fakeUsers = [];

    // Settings for creating matches for YOU (assuming you are in Stockholm)
    const targetCity = "Stockholm"; 
    const targetCountry = "Sweden";

    for (let i = 0; i < 60; i++) {
      const gender = faker.helpers.arrayElement(genders);
      const lookingFor = faker.helpers.arrayElement(genders);
      
      // Determine if this user should be a "Premium" member
      const isPremium = i < 15; 
      
      // Assign city: First 20 users are in your city to test "Near Me"
      const city = i < 20 ? targetCity : faker.helpers.arrayElement(["Gothenburg", "Malmo", "Uppsala", "Lund"]);

      // Mocking quiz traits for compatibility matching
      const traits = faker.helpers.arrayElements(["Introvert", "Extrovert", "Creative", "Analytical", "Adventurous"], 3);
      const mockCategories = new Map();
      mockCategories.set("Personality", traits.map(t => ({
        questionText: "How would you describe your vibe?",
        selectedText: "I am mostly " + t,
        trait: t,
        answeredAt: new Date()
      })));

      fakeUsers.push({
        name: faker.person.fullName(),
        email: faker.internet.email().toLowerCase(),
        password: hashedPassword,
        gender: gender,
        lookingFor: lookingFor,
        role: "user",
        birthday: {
          day: faker.number.int({ min: 1, max: 28 }).toString(),
          month: faker.number.int({ min: 1, max: 12 }).toString(),
          year: faker.number.int({ min: 1990, max: 2005 }).toString() 
        },
        location: {
          country: targetCountry,
          city: city
        },
        bio: faker.lorem.sentence() + " Looking for someone " + lookingFor + ".",
        interests: faker.helpers.arrayElements(["Music", "Tech", "Travel", "Art", "Cooking", "Sports", "Gaming", "Photography"], 3),
        avatar: `https://i.pravatar.cc/150?u=${faker.string.uuid()}`,
        subscription: {
          plan: isPremium ? "premium" : "free",
          status: "active",
          expiresAt: isPremium ? faker.date.future() : null
        },
        questionsbycategoriesResults: {
          categories: mockCategories
        }
      });
    }

    // 3. Insert into Database
    await User.insertMany(fakeUsers);
    
    console.log(`✅ Successfully seeded 60 users in ${targetCountry}!`);
    console.log(`📍 20 users are in ${targetCity} for proximity testing.`);
    console.log(`💎 15 users are set as Premium members.`);
    
    process.exit();
  } catch (err) {
    console.error("❌ Seeding Error:", err);
    process.exit(1);
  }
};

seedDB();