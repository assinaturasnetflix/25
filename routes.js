const express = require('express');
const { body } = require('express-validator');

// Middlewares
const { verifyUserToken, verifyAdminToken } = require('./auth');
const { upload } = require('./utils');

// Controladores
const systemController = require('./systemControllers');
const userController = require('./userControllers');
const adminController = require('./adminControllers');

// =======================================================
// ROTEADOR PRINCIPAL DA API (tudo começará com /api)
// =======================================================
const apiRouter = express.Router();


// --- Rotas de Autenticação: /api/auth/* ---
const authRouter = express.Router();
authRouter.post('/register', [
    body('storeName').notEmpty().trim(),
    body('phone').isMobilePhone('any', { strictMode: false }),
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 6 })
], systemController.register);

authRouter.post('/login', systemController.login);
authRouter.post('/verify-email', systemController.verifyEmail);
authRouter.post('/forgot-password', systemController.forgotPassword);
authRouter.post('/reset-password', systemController.resetPassword);
apiRouter.use('/auth', authRouter);


// --- Rotas do Usuário: /api/user/* ---
const userRouter = express.Router();
userRouter.use(verifyUserToken); // Protege todas as rotas abaixo

userRouter.get('/dashboard', userController.getDashboardData);
userRouter.get('/profile', userController.getUserProfile);
userRouter.post('/products', upload.array('images', 10), userController.createProduct);
userRouter.get('/products', userController.getProducts);
userRouter.get('/products/:id', userController.getProductById);
userRouter.put('/products/:id', upload.array('images', 10), userController.updateProduct);
userRouter.delete('/products/:id', userController.deleteProduct);
userRouter.post('/categories', userController.createCategory);
userRouter.get('/categories', userController.getCategories);
userRouter.put('/categories/:id', userController.updateCategory);
userRouter.delete('/categories/:id', userController.deleteCategory);
userRouter.post('/catalog-settings/profile-picture', upload.single('profilePicture'), userController.updateProfilePicture);
userRouter.post('/catalog-settings/cover-banner', upload.single('coverBanner'), userController.updateCoverBanner);
userRouter.put('/catalog-settings/customization', userController.updateStoreCustomization);
userRouter.put('/catalog-settings/socials', userController.updateSocialLinks);
userRouter.get('/plans', userController.getAvailablePlans);
userRouter.post('/plans/subscribe', upload.single('paymentProof'), userController.submitPaymentProof);
userRouter.get('/payment-history', userController.getPaymentHistory);
userRouter.get('/storage', userController.getStorageInfo);
userRouter.get('/storage/options', userController.getStorageOptions);
userRouter.post('/storage/buy', upload.single('paymentProof'), userController.buyExtraStorage);
apiRouter.use('/user', userRouter);


// --- Rotas do Administrador: /api/admin/* ---
const adminRouter = express.Router();
adminRouter.post('/login', adminController.adminLogin);
adminRouter.use(verifyAdminToken); // Protege todas as rotas abaixo

adminRouter.get('/users', adminController.getAllUsers);
adminRouter.post('/users/:userId/plan', adminController.changeUserPlan);
adminRouter.post('/users/:userId/status', adminController.updateUserStatus);
adminRouter.delete('/users/:userId', adminController.deleteUserAccount);
adminRouter.post('/users/:userId/custom-plan', adminController.createAndAssignCustomPlan);
adminRouter.get('/users/:userId/payment-history', adminController.getUserPaymentHistory);
adminRouter.get('/payments', adminController.getPendingPayments);
adminRouter.post('/payments/:paymentId/approve', adminController.approvePayment);
adminRouter.post('/payments/:paymentId/reject', adminController.rejectPayment);
adminRouter.get('/payments/storage', adminController.getPendingStoragePayments);
adminRouter.post('/payments/storage/:paymentId/approve', adminController.approveStoragePayment);
adminRouter.post('/payments/storage/:paymentId/reject', adminController.rejectStoragePayment);
adminRouter.post('/settings/payment-methods', adminController.addPaymentMethod);
adminRouter.get('/settings/payment-methods', adminController.getPaymentMethods);
adminRouter.delete('/settings/payment-methods/:methodId', adminController.deletePaymentMethod);
adminRouter.post('/settings/storage-options', adminController.addStorageOption);
adminRouter.get('/settings/storage-options', adminController.getStorageOptions);
adminRouter.put('/settings/storage-options/:optionId', adminController.updateStorageOption);
adminRouter.delete('/settings/storage-options/:optionId', adminController.deleteStorageOption);
adminRouter.get('/reports', adminController.getSystemReports);
adminRouter.get('/logs/errors', adminController.getErrorLogs);
adminRouter.get('/logs/emails', adminController.getEmailLogs);
adminRouter.post('/notifications/send', adminController.sendGlobalNotification);
apiRouter.use('/admin', adminRouter);


// --- Rota Pública do Catálogo: /api/:storeNameSlug ---
// Esta rota está no final do apiRouter para garantir que não captura rotas como '/api/user' ou '/api/admin'.
apiRouter.get('/:storeNameSlug', systemController.getStoreBySlug);


// Exportamos o apiRouter que será usado em server.js sob o prefixo /api
module.exports = apiRouter;