import express from 'express';
import { inviteUser, verifyAndSetup ,loginUser ,logoutUser,refreshToken,resetPassword,resetPasswordConfirm} from '../controllers/authController.js';

const authrouter = express.Router();

authrouter.post('/invite', inviteUser);
authrouter.post('/verify-setup', verifyAndSetup);
authrouter.post('/reset-password', resetPassword);
authrouter.post('/reset-password-confirm', resetPasswordConfirm);

authrouter.post('/login', loginUser);
authrouter.post('/refresh', refreshToken);
authrouter.post('/logout', logoutUser);


export default authrouter;