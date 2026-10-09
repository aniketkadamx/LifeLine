import { Router } from "express";
import { getMeHandler, updateMeHandler } from "../controllers/user.controller.js";
import { authenticate } from "../middlewares/auth.middleware.js";
import { validateBody } from "../validators/auth.validator.js";
import { updateUserSchema } from "../validators/user.validator.js";

export const userRouter = Router();

/**
 * GET /api/v1/users/me
 * Retrieves authenticated user details and linked role-specific profile.
 */
userRouter.get("/me", authenticate, getMeHandler);

/**
 * PATCH /api/v1/users/me
 * Updates self-service profile attributes (phone, avatar).
 */
userRouter.patch("/me", authenticate, validateBody(updateUserSchema), updateMeHandler);
