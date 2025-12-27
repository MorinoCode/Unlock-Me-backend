// mlocationRoutes.js

import express from "express";
import {getLocations} from "../controllers/location/locationController.js"

const router = express.Router();



router.get("/",  getLocations);




export default router;
