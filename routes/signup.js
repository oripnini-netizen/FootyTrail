import express from 'express';
import { signUpUser } from '../controllers/authController.js';

const router = express.Router();

router.post('/', signUpUser);

export default router;
