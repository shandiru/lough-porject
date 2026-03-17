import dotenv from 'dotenv';
dotenv.config();

const config = {
  port: process.env.PORT || 5000,
  mongoUri: process.env.MONGO_URI,
  clientUrl: process.env.CLIENT_URL,
  userlUrl: process.env.USER_URL,
  serverUrl: process.env.SERVER_URL,

  // ─── Timezone ─────────────────────────────────────────────────────────────
  // Change APP_TIMEZONE in your .env file to update the timezone.
  // Examples: 'Europe/London', 'Asia/Colombo', 'America/New_York'
  timezone: process.env.APP_TIMEZONE || 'Europe/London',

  adminSecretKey: process.env.ADMIN_SECRET_KEY,
  adminRefundKey: process.env.ADMIN_REFUND_KEY,

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
  },

  stripe: {
    secretKey:     process.env.STRIPE_SECRET_KEY,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
  },
};

export default config;
