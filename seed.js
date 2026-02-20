import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Location from './models/Location.js';

dotenv.config();

// لیست تمام کشورهایی که میخوای اضافه کنی
const countriesData = [
  {
    country: "USA",
    countryCode: "US",
    cities: [
      "New York", "Los Angeles", "Chicago", "Houston", "Phoenix",
      "Philadelphia", "San Antonio", "San Diego", "Dallas", "San Jose",
      "Austin", "Jacksonville", "San Francisco", "Columbus", "Fort Worth"
    ]
  },
  {
    country: "UAE",
    countryCode: "AE",
    cities: [
      "Dubai", "Abu Dhabi", "Sharjah", "Al Ain", "Ajman",
      "Ras Al Khaimah", "Fujairah", "Umm Al Quwain", "Khor Fakkan", "Kalba"
    ]
  },
  {
    country: "Sweden",
    countryCode: "SE",
    cities: [
      "Stockholm", "Gothenburg", "Malmo", "Uppsala", "Vasteras",
      "Orebro", "Linkoping", "Helsingborg", "Jonkoping", "Norrkoping"
    ]
  },
  {
    country: "Canada",
    countryCode: "CA",
    cities: [
      "Toronto", "Montreal", "Vancouver", "Calgary", "Edmonton",
      "Ottawa", "Winnipeg", "Quebec City", "Hamilton", "Kitchener"
    ]
  },
  {
    country: "Kuwait",
    countryCode: "KW",
    cities: [
      "Kuwait City", "Al Jahra", "Al Ahmadi", "Hawally", "Salmiya",
      "Sabah Al Salem", "Al Farwaniyah", "Fahaheel", "Jabriya", "Rumaithiya"
    ]
  },
  {
    country: "United Kingdom",
    countryCode: "GB",
    cities: [
      "London", "Birmingham", "Manchester", "Liverpool", "Leeds",
      "Sheffield", "Bristol", "Newcastle", "Sunderland", "Wolverhampton"
    ]
  },
  {
    country: "Saudi Arabia",
    countryCode: "SA",
    cities: [
      "Riyadh", "Jeddah", "Mecca", "Medina", "Dammam",
      "Taif", "Tabuk", "Buraydah", "Khamis Mushait", "Abha"
    ]
  },
  {
    country: "Brazil",
    countryCode: "BR",
    cities: [
      "Sao Paulo", "Rio de Janeiro", "Brasilia", "Salvador", "Fortaleza",
      "Belo Horizonte", "Manaus", "Curitiba", "Recife", "Porto Alegre"
    ]
  },
  {
    country: "India",
    countryCode: "IN",
    cities: [
      "Mumbai", "Delhi", "Bangalore", "Hyderabad", "Ahmedabad",
      "Chennai", "Kolkata", "Surat", "Pune", "Jaipur"
    ]
  },
  {
    country: "Qatar",
    countryCode: "QA",
    cities: [
      "Doha", "Al Rayyan", "Al Khor", "Al Wakrah", "Umm Salal",
      "Ash-Shahaniyah", "Mesaieed", "Madinat ash Shamal"
    ]
  },
  {
    country: "Oman",
    countryCode: "OM",
    cities: [
      "Muscat", "Salalah", "Seeb", "Sohar", "Nizwa",
      "Khasab", "Sur", "Bahla", "Ibra", "Rustaq"
    ]
  }
];

const seedDatabase = async (retryCount = 0) => {
  try {
    if (!process.env.MONGO_URI) {
      throw new Error("MONGO_URI is not defined in .env file");
    }

    console.log(`🔌 Attempting to connect to MongoDB (Attempt ${retryCount + 1})...`);
    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 60000, 
      connectTimeoutMS: 60000,
    });
    console.log("🔌 Connected to MongoDB...");

    for (const data of countriesData) {
      await Location.findOneAndUpdate(
        { countryCode: data.countryCode },
        { $set: data },
        { upsert: true, new: true }
      );
      console.log(`✅ ${data.country} processed.`);
    }

    console.log("👋 Done!");
    await mongoose.disconnect();
    process.exit(0);

  } catch (error) {
    console.error(`❌ Attempt ${retryCount + 1} failed:`, error.message);
    if (retryCount < 5) {
      const waitTime = (retryCount + 1) * 5000;
      console.log(`🔄 Retrying in ${waitTime/1000} seconds...`);
      setTimeout(() => seedDatabase(retryCount + 1), waitTime);
    } else {
      console.error("❌ Max retries reached. Exiting.");
      process.exit(1);
    }
  }
};

seedDatabase();
