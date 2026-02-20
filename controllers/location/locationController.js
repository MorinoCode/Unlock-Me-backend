import Location from "../../models/Location.js";
import { getAppCache, setAppCache } from "../../utils/cacheHelper.js";

const LOCATIONS_CACHE_TTL = 3600; // 1 hour

export const getLocations = async (req, res) => {
  try {
    const cached = await getAppCache("locations_list");
    if (cached) return res.status(200).json(cached);

    const locations = await Location.find({}).lean();
    await setAppCache("locations_list", locations, LOCATIONS_CACHE_TTL);
    res.status(200).json(locations);
  } catch (err) {
    console.error("Get Locations Error:", err);
    const errorMessage = process.env.NODE_ENV === 'production' 
      ? "Server error. Please try again later." 
      : err.message;
    res.status(500).json({ message: errorMessage });
  }
};

const GEOCODE_CACHE_TTL = 86400; // 24 hours

// Geocoding endpoint to get coordinates from city and country
export const geocodeCityCountry = async (req, res) => {
  try {
    const { city, country } = req.query;

    if (!city || !country) {
      return res.status(400).json({ message: "City and country are required" });
    }

    const key = `geocode_${String(city).trim().toLowerCase()}_${String(country).trim().toLowerCase()}`;
    const cached = await getAppCache(key);
    if (cached) return res.status(200).json(cached);

    // Using Nominatim (OpenStreetMap) - free geocoding service
    const query = encodeURIComponent(`${city}, ${country}`);
    const response = await fetch(`https://nominatim.openstreetmap.org/search?q=${query}&format=json&limit=1`, {
      headers: {
        'User-Agent': 'Unlock-Me-App/1.0' // Required by Nominatim
      }
    });

    if (!response.ok) {
      return res.status(response.status).json({
        message: "Geocoding service unavailable"
      });
    }

    const data = await response.json();

    if (data && data.length > 0) {
      const { lat, lon } = data[0];
      const result = {
        latitude: parseFloat(lat),
        longitude: parseFloat(lon)
      };
      await setAppCache(key, result, GEOCODE_CACHE_TTL);
      return res.status(200).json(result);
    }

    return res.status(404).json({
      message: "Location not found"
    });
  } catch (err) {
    console.error("Geocoding Error:", err);
    const errorMessage = process.env.NODE_ENV === 'production'
      ? "Geocoding service error. Please try again later."
      : err.message;
    res.status(500).json({ message: errorMessage });
  }
};
