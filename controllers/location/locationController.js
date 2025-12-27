import Location from'../../models/Location.js';

export const getLocations = async (req, res) => {
  try {
    const locations = await Location.find({});
    console.log(locations);
    res.status(200).json(locations);
  } catch (err) {
    res.status(500).json({ message: "Server Error",err });
  }
};