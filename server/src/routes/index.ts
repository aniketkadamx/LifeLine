import { Router } from "express";
import { authRouter } from "./auth.routes.js";

export const apiV1Router = Router();

// Mount auth router under /auth -> /api/v1/auth
apiV1Router.use("/auth", authRouter);

export { authRouter };
