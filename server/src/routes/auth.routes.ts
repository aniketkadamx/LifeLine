import { Router } from "express";
import { authLimiter } from "../middlewares/rate-limiter.middleware.js";
import { validateBody, registerSchema, loginSchema } from "../validators/auth.validator.js";
import {
  registerHandler,
  loginHandler,
  refreshTokenHandler,
  logoutHandler,
} from "../controllers/auth.controller.js";

export const authRouter = Router();

authRouter.post("/register", authLimiter, validateBody(registerSchema), registerHandler);
authRouter.post("/login", authLimiter, validateBody(loginSchema), loginHandler);
authRouter.post("/refresh-token", authLimiter, refreshTokenHandler);
authRouter.post("/logout", logoutHandler);
