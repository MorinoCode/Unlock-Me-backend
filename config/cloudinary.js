import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import multer from 'multer';
import dotenv from 'dotenv'

dotenv.config(); 

 cloudinary.config({
  cloud_name: process.env.CLOUDINARY_NAME,
  api_key: process.env.CLOUDINARY_KEY,
  api_secret: process.env.CLOUDINARY_SECRET
});

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'unlock_me_posts', // نام پوشه در کلود
    allowed_formats: ['jpg', 'png', 'jpeg'],
    transformation: [{ width: 1080, height: 1350, crop: 'limit' }] 
  },
});

export const upload = multer({ storage: storage });
export default cloudinary;