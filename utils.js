const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const cloudinary = require('cloudinary').v2;
const config = require('./config');

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});

const generateUniqueNumericId = async (model, field, length) => {
    let numericId;
    let isUnique = false;
    while (!isUnique) {
        numericId = Array.from({ length }, () => Math.floor(Math.random() * 10)).join('');
        const existingDoc = await model.findOne({ [field]: numericId });
        if (!existingDoc) {
            isUnique = true;
        }
    }
    return numericId;
};

const hashPassword = async (password) => {
    const salt = await bcrypt.genSalt(10);
    return await bcrypt.hash(password, salt);
};

const comparePassword = async (enteredPassword, hashedPassword) => {
    return await bcrypt.compare(enteredPassword, hashedPassword);
};

const generateToken = (id) => {
    return jwt.sign({ id }, process.env.JWT_SECRET, {
        expiresIn: config.security.jwtExpiresIn,
    });
};

const generateRandomCode = (length = 6) => {
    return Array.from({ length }, () => Math.floor(Math.random() * 10)).join('');
};

const sendEmail = async (options) => {
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS,
        },
        tls: {
            rejectUnauthorized: false
        }
    });

    const mailOptions = {
        from: `"${config.general.platformName}" <${process.env.EMAIL_USER}>`,
        to: options.to,
        subject: options.subject,
        html: options.html,
    };

    try {
        await transporter.sendMail(mailOptions);
        return true;
    } catch (error) {
        console.error('Error sending email:', error);
        return false;
    }
};

const uploadToCloudinary = async (filePath) => {
    try {
        const result = await cloudinary.uploader.upload(filePath, {
            folder: 'brainskill_assets',
            use_filename: true,
            unique_filename: true,
            overwrite: true
        });
        return {
            success: true,
            url: result.secure_url
        };
    } catch (error) {
        console.error('Cloudinary Upload Error:', error);
        return {
            success: false,
            message: 'Failed to upload image.'
        };
    }
};


module.exports = {
    generateUniqueNumericId,
    hashPassword,
    comparePassword,
    generateToken,
    generateRandomCode,
    sendEmail,
    uploadToCloudinary,
};