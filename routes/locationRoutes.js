// mlocationRoutes.js

import express from "express";
import {getLocations, geocodeCityCountry} from "../controllers/location/locationController.js"

const router = express.Router();

router.get("/",  getLocations);
router.get("/geocode", geocodeCityCountry);

export default router;
