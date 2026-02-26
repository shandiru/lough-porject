import jwt from 'jsonwebtoken';


export const verifyToken = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'Access token missing' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_ACCESSTOEKEN_KEY);
    req.user = decoded;

    next();
  } catch (error) {
    return res.status(401).json({
      message: 'Invalid or expired token'
    });
  }
};


export const verifyAdmin = (req, res, next) => {
 
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Admin access required' });
  }
  next();
};



export const verifyStaff = (req, res, next) => {
  
  if (!req.user || req.user.role !== 'staff') {
    return res.status(403).json({ message: 'staff access required' });
  }
  next();
};