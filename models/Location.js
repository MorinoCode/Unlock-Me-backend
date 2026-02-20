import mongoose from 'mongoose';

const LocationSchema = new mongoose.Schema({
  country: {
    type: String,
    required: true,
    unique: true 
  },
  countryCode: {
    type: String, 
    required: true
  },
  cities: [
    {
      type: String 
    }
  ]
});

export default mongoose.model('Location', LocationSchema);
