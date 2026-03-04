import dotenv from 'dotenv';
dotenv.config();

const config = {
  port: process.env.PORT || 5000,
  mongoUri: process.env.MONGO_URI,
  clientUrl: process.env.CLIENT_URL,
  userlUrl: process.env.USER_URL,
  serverUrl: process.env.SERVER_URL,  // backend own URL — verify email link-ku
 
  adminSecretKey: process.env.ADMIN_SECRET_KEY,
  
  jwt: {
  
    accessSecret: process.env.JWT_ACCESSTOEKEN_KEY, 
    refreshSecret: process.env.JWT_REFRESHTOEKEN_KEY,
  },

  
  email: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },


  google: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    redirectUri: process.env.GOOGLE_REDIRECT_URI,
  }
};

export default config;