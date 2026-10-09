import { Router } from "express";
import { authRouter } from "./auth.routes.js";
import { userRouter } from "./user.routes.js";

export const apiV1Router = Router();

// Mount auth router under /auth -> /api/v1/auth
apiV1Router.use("/auth", authRouter);

// Mount user router under /users -> /api/v1/users
apiV1Router.use("/users", userRouter);

export { authRouter, userRouter };
