import express from 'express';
import {
  registerCustomer,
  verifyEmail,
  resendVerification,
  loginCustomer,
  refreshCustomerToken,
  logoutCustomer,
  forgotPassword,
  resetPasswordConfirm,
} from '../controllers/customerAuthController.js';

const customerAuthRouter = express.Router();

customerAuthRouter.post('/register',            registerCustomer);
customerAuthRouter.get('/verify-email',         verifyEmail);        // GET — email link
customerAuthRouter.post('/resend-verification', resendVerification);
customerAuthRouter.post('/login',               loginCustomer);
customerAuthRouter.post('/refresh',             refreshCustomerToken);
customerAuthRouter.post('/logout',              logoutCustomer);
customerAuthRouter.post('/forgot-password',     forgotPassword);
customerAuthRouter.post('/reset-password',      resetPasswordConfirm);

export default customerAuthRouter;