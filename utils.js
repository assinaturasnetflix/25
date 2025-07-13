const nodemailer = require('nodemailer');
const { v4: uuidv4 } = require('uuid');
const config = require('./config');

const generateUserId = async (UserModel) => {
    let userId;
    let userExists = true;
    while (userExists) {
        const min = Math.pow(10, config.user.idLength - 1);
        const max = Math.pow(10, config.user.idLength) - 1;
        userId = Math.floor(Math.random() * (max - min + 1)) + min;
        userExists = await UserModel.findOne({ userId });
    }
    return userId.toString();
};

const generateTransactionId = () => {
    return `BS-TRX-${Date.now()}-${uuidv4().split('-')[0].toUpperCase()}`;
};

const generateGameId = () => {
    return `BS-GM-${Date.now()}-${uuidv4().split('-')[1].toUpperCase()}`;
};

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
});

const sendPasswordResetEmail = async (userEmail, token) => {
    const emailHtml = `
    <div style="font-family: Arial, sans-serif; color: ${config.style.emailTheme.textColor}; background-color: ${config.style.emailTheme.backgroundColor}; padding: 20px;">
        <div style="max-width: 600px; margin: auto; background: white; padding: 20px; border-radius: 8px;">
            <div style="background-color: ${config.style.emailTheme.headerColor}; color: white; padding: 10px; text-align: center; border-radius: 8px 8px 0 0;">
                <h2>${config.platform.name} - Recuperação de Senha</h2>
            </div>
            <div style="padding: 20px;">
                <p>Olá,</p>
                <p>Recebemos uma solicitação para redefinir a sua senha na plataforma BrainSkill.</p>
                <p>Use o código abaixo para criar uma nova senha. Este código é válido por 15 minutos.</p>
                <div style="text-align: center; margin: 20px 0;">
                    <span style="font-size: 24px; font-weight: bold; letter-spacing: 5px; background: #eee; padding: 10px 20px; border-radius: 5px;">${token}</span>
                </div>
                <p>Se você não solicitou esta alteração, pode ignorar este email com segurança.</p>
                <p>Atenciosamente,<br>Equipa BrainSkill</p>
            </div>
        </div>
    </div>
    `;

    const mailOptions = {
        from: `"${config.platform.name}" <${process.env.EMAIL_USER}>`,
        to: userEmail,
        subject: `Seu código de recuperação de senha - ${config.platform.name}`,
        html: emailHtml,
    };

    try {
        await transporter.sendMail(mailOptions);
        return true;
    } catch (error) {
        console.error('Error sending email:', error);
        return false;
    }
};

module.exports = {
    generateUserId,
    generateTransactionId,
    generateGameId,
    sendPasswordResetEmail,
};