import mongoose from 'mongoose';

const BlindQuestionSchema = new mongoose.Schema({
  text: {
    type: String,
    required: true
  },
  options: [{
    type: String,
    required: true
  }],
  category: {
    type: String,
    required: true
  },
  stage: {
    type: Number,
    required: true,
    enum: [1, 2]
  }
});

const BlindQuestion = mongoose.model('BlindQuestion', BlindQuestionSchema);
export default BlindQuestion;