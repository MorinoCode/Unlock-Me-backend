import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Location from './models/Location.js';

dotenv.config();

// لیست تمام کشورهایی که میخوای اضافه کنی
const countriesData = [
  {
    country: "Sweden",
    countryCode: "SE",
    cities: [
      "Stockholm", "Göteborg", "Malmö", "Uppsala", "Västerås",
      "Örebro", "Linköping", "Helsingborg", "Jönköping", "Norrköping",
      "Lund", "Umeå", "Gävle", "Borås", "Södertälje"
    ]
  },
  {
    country: "Kuwait",
    countryCode: "KW", // کد ایزو کویت
    cities: [
      "Kuwait City",
      "Al Jahra",
      "Al Ahmadi",
      "Hawally",
      "Salmiya",
      "Sabah Al Salem",
      "Al Farwaniyah",
      "Fahaheel",
      "Jabriya",
      "Rumaithiya"
    ]
  }
];

const seedDatabase = async () => {
  try {
    if (!process.env.MONGO_URI) {
      throw new Error("MONGO_URI is not defined in .env file");
    }

    await mongoose.connect(process.env.MONGO_URI);
    console.log("🔌 Connected to MongoDB...");

    // حلقه روی تمام کشورها
    for (const data of countriesData) {
      const exists = await Location.findOne({ countryCode: data.countryCode });
      
      if (!exists) {
        await Location.create(data);
        console.log(`✅ ${data.country} added to DB!`);
      } else {
        console.log(`ℹ️ ${data.country} already exists. Skipping...`);
        // اگر خواستی لیست شهرها رو آپدیت کنی، میتونی اینجا کد آپدیت بنویسی
        // مثلا:
        // await Location.updateOne({ countryCode: data.countryCode }, { $set: { cities: data.cities } });
        // console.log(`🔄 ${data.country} cities updated.`);
      }
    }

    console.log("👋 Done!");
    await mongoose.disconnect();
    process.exit(0);

  } catch (error) {
    console.error("❌ Error:", error);
    process.exit(1);
  }
};

seedDatabase();