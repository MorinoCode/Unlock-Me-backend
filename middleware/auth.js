import jwt from "jsonwebtoken";

export const protect = (req, res, next) => {
  const token = req.cookies["unlock-me-token"]; 

  if (!token) {
    return res.status(401).json({ message: "No token, authorization denied" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; 
    
    next();
  } catch (err) {
    return res.status(401).json({ message: "Token is not valid" });
  }
};
