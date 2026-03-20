// utils/mailer.js
import nodemailer from 'nodemailer';
import config from '../config/index.js';

let transporter = null;

const getMailer = () => {
    if (!transporter) {
        transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: config.email.user,
                pass: config.email.pass,
            },
        });
    }
    return transporter;
};

export const sendMail = async (to, { subject, html }) => {
    await getMailer().sendMail({ to, subject, html });
};